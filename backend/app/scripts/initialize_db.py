"""
Initialize PostgreSQL movie database from TSV movie data.

- Waits for Postgres to be ready
- Loads full movies.tsv (11k+ movies)
- Loads precomputed 128-dim pgvector embeddings from TSV
- Stores vectors directly into Postgres (pgvector)
- Runs exactly once (idempotent)
"""

import csv
import time
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal, engine
from app.models import Movie


# CONFIG
TSV_PATH = Path(__file__).resolve().parents[2] / "data" / "movies.tsv"
MAX_DB_WAIT_SECONDS = 60
DB_RETRY_INTERVAL = 2

print("TSV exists:", TSV_PATH.exists())


def wait_for_db():
    """Block until Postgres is accepting connections."""
    print("Waiting for Postgres to be ready...")

    deadline = time.time() + MAX_DB_WAIT_SECONDS

    while time.time() < deadline:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("Postgres is ready.")
            return
        except OperationalError:
            print("Postgres not ready yet. Retrying...")
            time.sleep(DB_RETRY_INTERVAL)

    raise RuntimeError("Postgres did not become ready in time")


def database_already_initialized(db: Session) -> bool:
    """Authoritative idempotency check."""
    return db.query(Movie.id).limit(1).first() is not None


def main():
    wait_for_db()

    # Ensure pgvector is enabled
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    db: Session = SessionLocal()

    try:
        # Idempotency guard
        if database_already_initialized(db):
            print("Database already initialized. Skipping movie import.")
            return

        movies = []

        with TSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")

            for row in reader:
                if not row.get("title"):
                    continue

                embedding = [
                    float(row[f"embedding_{i}"])
                    for i in range(128)
                ]

                movies.append({
                    "title": row["title"].strip(),
                    "startYear": int(row["startYear"]) if row.get("startYear") else None,
                    "imdb_rating": float(row["imdb_rating"]) if row.get("imdb_rating") else None,
                    "imdb_votes": int(row["imdb_votes"]) if row.get("imdb_votes") else None,
                    "overview": row.get("overview") or "",
                    "tmdb_genres": row.get("tmdb_genres") or "",
                    "poster_path": row.get("poster_path"),
                    "embedding": embedding,
                })

        print(f"Loaded {len(movies)} movies from TSV")

        print("Inserting movies into Postgres...")

        for m in movies:
            db.add(Movie(
                title=m["title"],
                startYear=m["startYear"],
                imdb_rating=m["imdb_rating"],
                imdb_votes=m["imdb_votes"],
                overview=m["overview"],
                tmdb_genres=m["tmdb_genres"],
                poster_path=m["poster_path"],
                embedding=m["embedding"],
            ))

        db.commit()
        print(f"Inserted {len(movies)} movies into the database.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
