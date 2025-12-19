#!/bin/sh
set -e

echo "Running database initialization (idempotent)..."
python -m app.scripts.initialize_db

echo "Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
