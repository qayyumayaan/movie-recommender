import csv
from pathlib import Path

from sentence_transformers import SentenceTransformer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import Movie


CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "movies.csv"


def main():
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    # Ensure vector extension exists
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    db: Session = SessionLocal()
    try:
        with CSV_PATH.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            titles = [row["title"].strip() for row in reader if row.get("title")]

        embeddings = model.encode(titles, batch_size=32, show_progress_bar=True)

        for title, emb in zip(titles, embeddings):
            if db.query(Movie).filter_by(title=title).first():
                continue
            movie = Movie(title=title, embedding=emb.tolist())
            db.add(movie)

        db.commit()
        print(f"Inserted/updated {len(titles)} movies.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
