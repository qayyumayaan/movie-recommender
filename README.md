# Movie Recommendation System

This is a full stack, immediately deployable application that hosts a backend, frontend, and PostgreSQL database server. 

There are three elements of this program: The backend, frontend, and postgreSQL database. 

The goal of this program is to use vector similarity searches to recommend movies to users. The techniques in this project are training-free, except for the embedding model. 

The backend is written with Python and FastAPI. 

To properly run this program, add your OpenAI API key in the empty template `cred.env` file in `./backend/cred.env`. You will need this to encode all text movies in the database. 

Then compile all three Docker environments. Please cd into the project root folder and run:

```zsh
docker compose up
```

If the above doesn't work, try running this:
```zsh
docker compose down
docker compose build
docker compose up -d
```

Please enter the `backend` Docker environment and run this in the `./app` directory:

```
python -m app.scripts.initialize_db
```

It will encode all of the raw data to form the database. 


Special thanks to The Movies Database (TMDB) and IMDB for the non-commercial use movie databases. 