"""
Initialize PostgreSQL movie database from TSV movie data.

- Loads full movies.tsv (11k+ movies)
- Generates OpenAI embeddings (using combined textual fields)
- Runs PCA reduction (1536 → 128 dims) globally
- Stores reduced vectors into Postgres (pgvector)
- Saves PCA model for future inference
"""

import csv
from pathlib import Path
import os

from sqlalchemy import text
from sqlalchemy.orm import Session

from dotenv import load_dotenv
import joblib
from sklearn.decomposition import PCA
from openai import OpenAI

from app.database import SessionLocal, engine
from app.models import Movie


# CONFIG
TSV_PATH = Path(__file__).resolve().parents[2] / "data" / "movies.tsv"
ENV_PATH = "./app/cred.env"

print("TSV exists:", TSV_PATH.exists())
print("ENV:", ENV_PATH)

load_dotenv(ENV_PATH)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# MAIN
def main():

    # Ensure pgvector is enabled
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    db: Session = SessionLocal()

    try:
        # Load TSV movie data
        movies = []
        with TSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                # Skip entries without a title
                if not row.get("title"):
                    continue

                movies.append({
                    "title": row["title"].strip(),
                    "startYear": row.get("startYear"),
                    "imdb_rating": row.get("imdb_rating"),
                    "imdb_votes": row.get("imdb_votes"),
                    "overview": row.get("overview") or "",
                    "tagline": row.get("tagline") or "",
                    "tmdb_genres": row.get("tmdb_genres") or "",
                    "keywords": row.get("keywords") or "",
                    "poster_path": row.get("poster_path"),
                })

        print(f"Loaded {len(movies)} movies from TSV")

        # Build embedding prompts
        print("Building embedding text for each movie...")

        embedding_inputs = []
        for m in movies:
            text_blob = " ".join([
                m["title"],
                m["overview"],
                m["tagline"],
                m["tmdb_genres"],
                m["keywords"]
            ]).strip()

            # OpenAI recommends avoiding empty strings
            embedding_inputs.append(text_blob if text_blob else m["title"])

        print(f"Prepared {len(embedding_inputs)} embedding inputs")

        # Create OpenAI embeddings (1536 dimensions)
        print("Calling OpenAI to generate embeddings...")

        response = client.embeddings.create(
            input=embedding_inputs,
            model="text-embedding-3-small"
        )

        original_embs = [d.embedding for d in response.data]
        print("OpenAI embedding generation complete")

        # PCA Reduction (global)
        pca_dim = 128
        print(f"Running PCA: original 1536 → {pca_dim}")

        pca = PCA(n_components=pca_dim)
        reduced_embs = pca.fit_transform(original_embs)

        print("PCA reduction complete")

        joblib.dump(pca, "pca_model.joblib")
        print("Saved PCA model → pca_model.joblib")

        # Insert movies with embeddings
        print("Inserting movies into Postgres...")

        inserted = 0
        for m, vec in zip(movies, reduced_embs):

            movie = Movie(
                title=m["title"],
                startYear=m["startYear"],
                imdb_rating=m["imdb_rating"],
                imdb_votes=m["imdb_votes"],
                overview=m["overview"],
                tmdb_genres=m["tmdb_genres"],
                poster_path=m["poster_path"],
                embedding=vec.tolist()
            )

            db.add(movie)
            inserted += 1

        db.commit()
        print(f"Inserted {inserted} movies into the database.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
