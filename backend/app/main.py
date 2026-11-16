from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os

app = FastAPI(title="Movie Recommender Playground")

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SHUTDOWN_MESSAGE = {"detail": "The project has shut down. Thank you for using it!"}


@app.middleware("http")
async def shutdown_middleware(request: Request, call_next):
    return JSONResponse(status_code=503, content=SHUTDOWN_MESSAGE)
