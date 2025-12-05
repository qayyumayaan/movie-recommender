from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select, func

from .. import models, schemas, auth
from ..database import get_db

import numpy as np
# from sklearn.manifold import TSNE
import umap
from typing import Optional, List
TSNE_CACHE = {}  

router = APIRouter(prefix="/movies", tags=["movies"])


def get_random_unseen_movie(db: Session, user_id: int) -> Optional[models.Movie]:
    rated_subq = (
        select(models.Rating.movie_id).where(models.Rating.user_id == user_id)
    )

    stmt = (
        select(models.Movie)
        .where(models.Movie.id.not_in(rated_subq))
        .order_by(func.random())
        .limit(1)
    )
    result = db.execute(stmt).scalars().first()
    return result


def compute_user_profile_vector(
    db: Session,
    user_id: int,
) -> Optional[List[float]]:
    """
    Build a simple user preference vector from their ratings.

    👍 = +1
    👎 = -1

    We average all (embedding * weight) to get a single vector.
    """
    ratings = (
        db.query(models.Rating)
        .options(joinedload(models.Rating.movie))
        .filter(models.Rating.user_id == user_id)
        .all()
    )

    if not ratings:
        return None

    # Collect all embeddings with weights
    weighted_vectors: List[List[float]] = []
    weights: List[float] = []

    for r in ratings:
        emb = r.movie.embedding
        if emb is None:
            continue

        # emb is typically a list[float] from pgvector
        weight = 1.0 if r.rating else -1.0
        weighted_vectors.append(list(emb))
        weights.append(weight)

    if not weighted_vectors:
        return None

    dim = len(weighted_vectors[0])
    agg = [0.0] * dim
    total_weight = 0.0

    for vec, w in zip(weighted_vectors, weights):
        for i in range(dim):
            agg[i] += vec[i] * w
        total_weight += abs(w)

    if total_weight == 0:
        return None

    # Normalize
    profile = [x / total_weight for x in agg]
    return profile


def get_smart_unseen_movie(db: Session, user_id: int) -> Optional[models.Movie]:
    """
    Use pgvector similarity to pick the nearest unseen movie to the user's profile.
    Falls back to None if profile cannot be computed.
    """
    user_profile = compute_user_profile_vector(db, user_id)
    if user_profile is None:
        return None

    rated_subq = (
        select(models.Rating.movie_id).where(models.Rating.user_id == user_id)
    )

    # Order unseen movies by cosine distance to user_profile (lower = more similar)
    order_clause = models.Movie.embedding.cosine_distance(user_profile)

    stmt = (
        select(models.Movie)
        .where(models.Movie.id.not_in(rated_subq))
        .order_by(order_clause)
        .limit(1)
    )

    result = db.execute(stmt).scalars().first()
    return result


@router.get("/random", response_model=schemas.MovieOut)
def next_movie(
    mode: str = Query("random", pattern="^(random|smart)$"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    mode=random -> uniform random unseen movie (old behavior)
    mode=smart  -> vector-based recommendation based on previous ratings
    """
    if mode == "smart":
        movie = get_smart_unseen_movie(db, current_user.id)
        # If there's no good smart candidate, gracefully fall back to random
        if not movie:
            movie = get_random_unseen_movie(db, current_user.id)
    else:
        movie = get_random_unseen_movie(db, current_user.id)

    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No more unseen movies",
        )

    return movie


@router.post("/rate", response_model=schemas.RatingOut)
def rate_movie(
    rating_in: schemas.RatingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    movie = db.query(models.Movie).filter(models.Movie.id == rating_in.movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    rating = (
        db.query(models.Rating)
        .filter(
            models.Rating.user_id == current_user.id,
            models.Rating.movie_id == rating_in.movie_id,
        )
        .first()
    )

    if rating:
        rating.rating = rating_in.rating
    else:
        rating = models.Rating(
            user_id=current_user.id,
            movie_id=rating_in.movie_id,
            rating=rating_in.rating,
        )
        db.add(rating)

    db.commit()
    db.refresh(rating)

    return schemas.RatingOut(
        movie_title=movie.title,
        rating=rating.rating,
        created_at=rating.created_at,
    )


@router.get("/history", response_model=list[schemas.RatingOut])
def get_history(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    ratings = (
        db.query(models.Rating)
        .options(joinedload(models.Rating.movie))
        .filter(models.Rating.user_id == current_user.id)
        .order_by(models.Rating.created_at.desc())
        .all()
    )

    return [
        schemas.RatingOut(
            movie_title=r.movie.title,
            rating=r.rating,
            created_at=r.created_at,
        )
        for r in ratings
    ]


@router.post("/history/reset")
def reset_history(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db.query(models.Rating).filter(models.Rating.user_id == current_user.id).delete()
    db.commit()
    return {"detail": "History reset"}

TSNE_CACHE = {}   # global cache: stores UMAP, movie projections, etc.


@router.get("/space")
def movie_space(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Returns 2D UMAP embeddings for all movies + the user's preference vector.
    Uses a global cache so UMAP is computed only once for the lifetime of the server.
    """
    # ---- Step 1: Fetch all movies ----
    movies = db.query(models.Movie).all()
    if not movies:
        return {"points": [], "user_point": None}

    movie_ids = []
    movie_titles = []
    embs = []

    for m in movies:
        if m.embedding is None:
            continue
        movie_ids.append(m.id)
        movie_titles.append(m.title)
        embs.append(list(m.embedding))

    if not embs:
        return {"points": [], "user_point": None}

    X = np.array(embs, dtype=float)
    num_movies = X.shape[0]

    # ---- Step 2: If cache is missing or stale, rebuild UMAP ----
    cache_key = "umap"

    need_rebuild = (
        cache_key not in TSNE_CACHE
        or TSNE_CACHE[cache_key]["num_movies"] != num_movies
    )

    if need_rebuild:
        # Train UMAP one single time
        reducer = umap.UMAP(
            n_components=2,
            n_neighbors=400,
            min_dist=0.1,
            metric="cosine",
            random_state=42,
        )
        movie_coords = reducer.fit_transform(X)

        TSNE_CACHE[cache_key] = {
            "reducer": reducer,
            "movie_coords": movie_coords,
            "movie_ids": movie_ids,
            "movie_titles": movie_titles,
            "X": X,                # original embeddings
            "num_movies": num_movies,
        }
    else:
        reducer = TSNE_CACHE[cache_key]["reducer"]
        movie_coords = TSNE_CACHE[cache_key]["movie_coords"]
        movie_ids = TSNE_CACHE[cache_key]["movie_ids"]
        movie_titles = TSNE_CACHE[cache_key]["movie_titles"]

    # ---- Step 3: Compute user vector and project it through cached UMAP ----
    user_profile = compute_user_profile_vector(db, current_user.id)

    if user_profile is not None:
        # UMAP transform – very fast (no retraining!)
        user_vec = np.array(user_profile, dtype=float)
        user_2d = reducer.transform([user_vec])[0]
        user_point = {"x": float(user_2d[0]), "y": float(user_2d[1])}
    else:
        user_point = None

    # ---- Step 4: Color coding: liked, disliked, unseen ----
    ratings = (
        db.query(models.Rating)
        .filter(models.Rating.user_id == current_user.id)
        .all()
    )
    rating_map = {r.movie_id: r.rating for r in ratings}

    points = []
    for mid, title, coord in zip(movie_ids, movie_titles, movie_coords):
        rating = rating_map.get(mid, None)
        points.append({
            "id": mid,
            "title": title,
            "x": float(coord[0]),
            "y": float(coord[1]),
            "rating": rating,
        })

    return {"points": points, "user_point": user_point}

@router.get("/influence")
def movie_influence(
    movie_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Fetch the current recommended movie
    target_movie = db.query(models.Movie).filter(models.Movie.id == movie_id).first()
    if not target_movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    target_emb = np.array(target_movie.embedding, dtype=float)

    # Fetch all rated movies for the user
    ratings = (
        db.query(models.Rating)
        .options(joinedload(models.Rating.movie))
        .filter(models.Rating.user_id == current_user.id)
        .all()
    )

    influences = []

    for r in ratings:
        emb = np.array(r.movie.embedding, dtype=float)
        weight = 1 if r.rating else -1

        # cosine weighted influence
        influence = float(
            np.dot(emb * weight, target_emb)
            / (np.linalg.norm(emb) * np.linalg.norm(target_emb))
        )

        influences.append({
            "movie_id": r.movie.id,
            "movie_title": r.movie.title,
            "rating": r.rating,
            "influence": influence,
        })

    # Keep positively rated movies
    positive_influences = [inf for inf in influences if inf["rating"] == True]

    # Sort by highest positive influence
    positive_influences.sort(key=lambda x: x["influence"], reverse=True)

    # Return top 5
    return positive_influences[:5]

