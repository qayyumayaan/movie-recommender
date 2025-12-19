import csv
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Movie

# Highest practical precision for text round-tripping of IEEE-754 double
def f64_str(x) -> str:
    # Convert to Python float (64-bit) even if x is np.float32 / pgvector scalar
    return format(float(x), ".17g")  # round-trip safe


def export_movies_to_tsv(output_path: str = "movies.tsv") -> None:
    db: Session = SessionLocal()
    try:
        movies = db.query(Movie).yield_per(1000)

        base_fields = [
            "id", "title", "startYear", "imdb_rating", "imdb_votes",
            "overview", "tmdb_genres", "poster_path",
        ]
        embedding_fields = [f"embedding_{i}" for i in range(128)]
        fieldnames = base_fields + embedding_fields

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
            writer.writerow(fieldnames)

            row_count = 0
            for movie in movies:
                if movie.embedding is None:
                    embedding = [""] * 128
                else:
                    embedding = [f64_str(x) for x in movie.embedding]

                writer.writerow([
                    movie.id,
                    movie.title,
                    movie.startYear,
                    movie.imdb_rating,
                    movie.imdb_votes,
                    movie.overview,
                    movie.tmdb_genres,
                    movie.poster_path,
                    *embedding,
                ])
                row_count += 1

        print(f"Exported {row_count} movies to {output_path} with max-safe float precision.")
    finally:
        db.close()


if __name__ == "__main__":
    export_movies_to_tsv("movies.tsv")
