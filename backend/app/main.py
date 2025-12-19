from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .database import Base, engine
from .routers import auth_routes, movie_routes
import os
app = FastAPI(title="Movie Recommender Playground")

# Frontend runs at http://localhost:8080
origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,      # cannot be "*" if using credentials (cookies)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # Ensure pgvector extension and tables exist
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)


app.include_router(auth_routes.router)
app.include_router(movie_routes.router)
