from datetime import datetime
from pydantic import BaseModel, EmailStr
from pydantic.config import ConfigDict
from typing import Optional


# User
class UserBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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

# Movies & Data
class MovieOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    overview: Optional[str]
    startYear: Optional[int]
    imdb_rating: Optional[float]
    imdb_votes: Optional[int]
    tmdb_genres: Optional[str]
    poster_path: Optional[str]
    
    is_favorite: bool = False


class RatingCreate(BaseModel):
    movie_id: int
    rating: bool  # true = thumbs up, false = thumbs down


class RatingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    movie_id: int
    movie_title: str
    rating: bool
    created_at: datetime
    is_favorite: bool = False

class FavoriteToggleIn(BaseModel):
    movie_id: int


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    movie_id: int
    movie_title: str
    created_at: datetime