"""
Common SQLAlchemy ORM queries for Movie database.
Run this file directly to experiment with querying the database.
"""

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Movie


def show_basic_queries():
    db: Session = SessionLocal()

    try:
        # Count rows in the Movie table 
        movie_count = db.query(Movie).count()
        print(f"Total movies in database: {movie_count}")

        # Get all movies
        all_movies = db.query(Movie).all()
        print(f"First 5 movies: {[m.title for m in all_movies[:5]]}")

        # Query by exact match
        batman = db.query(Movie).filter_by(title="Batman Begins").first()
        if batman:
            print("Found:", batman.title)
        else:
            print("Batman Begins not found")

        # Query using LIKE (case-insensitive search)
        search_term = "man"
        results = db.query(Movie).filter(Movie.title.ilike(f"%{search_term}%")).all()
        print(f"Movies containing '{search_term}': {[m.title for m in results]}")

        # Query by Movie ID
        movie_id = 1
        movie = db.query(Movie).get(movie_id)
        if movie:
            print(f"Movie with ID {movie_id}: {movie.title}")

        # Order results
        ordered = db.query(Movie).order_by(Movie.title.asc()).limit(10).all()
        print("Alphabetical first 10:", [m.title for m in ordered])


        # The next two write to the DB. 
        # # Update a movie
        # movie_to_update = db.query(Movie).filter_by(title="The Matrix").first()
        # if movie_to_update:
        #     print("Updating The Matrix…")
        #     movie_to_update.title = "The Matrix (1999)"
        #     db.commit()

        # # Delete a movie
        # to_delete = db.query(Movie).filter_by(title="DELETE ME").first()
        # if to_delete:
        #     print("Deleting:", to_delete.title)
        #     db.delete(to_delete)
        #     db.commit()

    finally:
        db.close()


if __name__ == "__main__":
    show_basic_queries()
