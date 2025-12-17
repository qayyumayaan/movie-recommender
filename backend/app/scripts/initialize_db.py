"""
Initialize PostgreSQL movie database from TSV movie data.

- Loads full movies.tsv (11k+ movies)
- Loads precomputed 128-dim pgvector embeddings from TSV
- Stores vectors directly into Postgres (pgvector)
"""

import csv
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import Movie


# CONFIG
TSV_PATH = Path(__file__).resolve().parents[2] / "data" / "movies.tsv"

print("TSV exists:", TSV_PATH.exists())


def main():

    # Ensure pgvector is enabled
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    db: Session = SessionLocal()

    try:
        movies = []

        with TSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")

            for row in reader:
                if not row.get("title"):
                    continue

                # Load 128-dim embedding
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

        # Insert movies
        print("Inserting movies into Postgres...")

        for m in movies:
            movie = Movie(
                title=m["title"],
                startYear=m["startYear"],
                imdb_rating=m["imdb_rating"],
                imdb_votes=m["imdb_votes"],
                overview=m["overview"],
                tmdb_genres=m["tmdb_genres"],
                poster_path=m["poster_path"],
                embedding=m["embedding"],
            )
            db.add(movie)

        db.commit()
        print(f"Inserted {len(movies)} movies into the database.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
