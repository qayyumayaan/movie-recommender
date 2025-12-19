from datetime import datetime
from pydantic import BaseModel, EmailStr
from typing import Optional


# User
class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    username_or_email: str
    password: str


class UserOut(UserBase):
    id: int
    created_at: datetime

    class Config:
        orm_mode = True

# Movies & Data
class MovieOut(BaseModel):
    id: int
    title: str
    overview: Optional[str]
    startYear: Optional[int]
    imdb_rating: Optional[float]
    imdb_votes: Optional[int]
    tmdb_genres: Optional[str]
    poster_path: Optional[str]

    class Config:
        orm_mode = True


class RatingCreate(BaseModel):
    movie_id: int
    rating: bool  # true = thumbs up, false = thumbs down


class RatingOut(BaseModel):
    movie_title: str
    rating: bool
    created_at: datetime

    class Config:
        orm_mode = True
