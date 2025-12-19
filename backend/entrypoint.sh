#!/bin/sh
set -e

echo "Starting background DB initialization..."
python -m app.scripts.initialize_db || true &

echo "Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
