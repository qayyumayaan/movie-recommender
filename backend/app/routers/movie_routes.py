from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select, func

from .. import models, schemas, auth
from ..database import get_db

import numpy as np
from sklearn.manifold import TSNE
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

@router.get("/space")
def movie_space(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Returns a 2D t-SNE embedding for all movies, plus the current user's preference
    vector projected into the same space. Also includes whether each movie has been
    liked/disliked/unseen by this user.
    """
    movies = db.query(models.Movie).all()
    if not movies:
        return {"points": [], "user_point": None}

    # Collect embeddings and ids
    movie_ids: List[int] = []
    movie_titles: List[str] = []
    embs: List[List[float]] = []

    for m in movies:
        if m.embedding is None:
            continue
        movie_ids.append(m.id)
        movie_titles.append(m.title)
        embs.append(list(m.embedding))

    if not embs:
        return {"points": [], "user_point": None}

    X = np.array(embs, dtype=float)

    # User profile vector
    user_profile = compute_user_profile_vector(db, current_user.id)

    # Build matrix for t-SNE (movies plus user profile if available)
    if user_profile is not None:
        X_all = np.vstack([X, np.array(user_profile, dtype=float)])
        include_user = True
    else:
        X_all = X
        include_user = False

    n_samples = X_all.shape[0]
    # t-SNE needs perplexity < n_samples
    perplexity = min(50, max(5, n_samples - 1))

    tsne = TSNE(
        n_components=2,
        perplexity=perplexity,
        learning_rate="auto",
        init="random",
        random_state=42,
    )
    Y_all = tsne.fit_transform(X_all)

    if include_user:
        movie_coords = Y_all[:-1]
        user_coord = Y_all[-1]
        user_point = {"x": float(user_coord[0]), "y": float(user_coord[1])}
    else:
        movie_coords = Y_all
        user_point = None

    # Get user ratings to color points
    ratings = (
        db.query(models.Rating)
        .filter(models.Rating.user_id == current_user.id)
        .all()
    )
    rating_map = {r.movie_id: r.rating for r in ratings}  # True/False

    points = []
    for (mid, title, coord) in zip(movie_ids, movie_titles, movie_coords):
        rating = rating_map.get(mid, None)
        points.append(
            {
                "id": mid,
                "title": title,
                "x": float(coord[0]),
                "y": float(coord[1]),
                "rating": rating,  # true / false / null
            }
        )

    return {"points": points, "user_point": user_point}
