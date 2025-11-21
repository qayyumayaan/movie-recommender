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


CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "movies.csv"
ENV_PATH = "./app/cred.env"

print("CSV exists:", CSV_PATH.exists())
print("ENV:", ENV_PATH)

load_dotenv(ENV_PATH)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def main():

    # Ensure vector extension exists
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    db: Session = SessionLocal()
    try:
        # Load all movie titles
        with CSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            titles = [row["title"].strip() for row in reader if row.get("title")]

        print(f"Loaded {len(titles)} titles")

        # Generate embeddings (1536 dims)
        response = client.embeddings.create(
            input=titles,
            model="text-embedding-3-small"
        )
        original_embeddings = [d.embedding for d in response.data]
        print("Generated embeddings")

        # PCA: Fit on all 680 embeddings (one-time global reduction)
        pca_dim = 128
        print(f"Training PCA: 1536 → {pca_dim}")
        pca = PCA(n_components=pca_dim)
        reduced_embeddings = pca.fit_transform(original_embeddings)
        print("PCA complete")

        # Save PCA model for future new movies
        joblib.dump(pca, "pca_model.joblib")
        print("Saved PCA model to pca_model.joblib")

        # Insert reduced vectors into database
        for title, emb128 in zip(titles, reduced_embeddings):
            movie = Movie(title=title, embedding=emb128.tolist())
            db.add(movie)

        db.commit()
        print(f"Inserted {len(titles)} PCA-reduced movies.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
