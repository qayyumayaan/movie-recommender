from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select, func

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/movies", tags=["movies"])


def get_random_unseen_movie(db: Session, user_id: int) -> models.Movie | None:
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


@router.get("/random", response_model=schemas.MovieOut)
def random_movie(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
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
