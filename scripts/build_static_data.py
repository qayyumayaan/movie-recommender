#!/usr/bin/env python3
"""
Convert backend/data/movies.tsv into static files the browser can load.

Outputs (in frontend/data/):
  movies.json     {"dim": 128, "movies": [ [id, title, year, rating, votes, overview, poster], ... ]}
                  The array index of each movie is its "slot". Slots are what the
                  64-character profile code stores, so they must NEVER change.
                  A removed movie becomes null; new movies are appended.
  embeddings.bin  Float32 little-endian, slot-major (slot * dim + i).
                  Null slots are written as zero vectors.

Slots stay stable between rebuilds: if movies.json already exists, its slot
order is kept and only new IDs are appended. The profile code has 12 bits per
slot (slots 0..4094), so there is room for ~4095 movies in total.

Usage:
    python3 scripts/build_static_data.py [path/to/movies.tsv]
"""

import csv
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TSV_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "backend" / "data" / "movies.tsv"
OUT_DIR = ROOT / "frontend" / "data"
MAX_SLOTS = 4095  # 12-bit slot field, 0 is reserved for "empty"


def num(value, cast):
    value = (value or "").strip()
    return cast(float(value)) if value else None


def main():
    csv.field_size_limit(10**9)
    with open(TSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))

    emb_cols = sorted(
        (c for c in rows[0] if c.startswith("embedding_")),
        key=lambda c: int(c.split("_")[1]),
    )
    dim = len(emb_cols)
    by_id = {int(r["id"]): r for r in rows}

    # Keep existing slot order so previously issued profile codes stay valid.
    existing = OUT_DIR / "movies.json"
    slot_ids = []
    if existing.exists():
        old = json.loads(existing.read_text(encoding="utf-8"))
        if old.get("dim") != dim:
            sys.exit(f"Embedding dim changed ({old.get('dim')} -> {dim}); slots/profile codes would break.")
        slot_ids = [m[0] if m else None for m in old["movies"]]
    known = {i for i in slot_ids if i is not None}
    slot_ids += sorted(i for i in by_id if i not in known)

    if len(slot_ids) > MAX_SLOTS:
        sys.exit(f"{len(slot_ids)} slots exceeds the {MAX_SLOTS} the profile code can address.")

    movies = []
    emb = bytearray()
    zero = struct.pack(f"<{dim}f", *([0.0] * dim))
    for mid in slot_ids:
        r = by_id.get(mid) if mid is not None else None
        if r is None:
            movies.append(None)
            emb += zero
            continue
        movies.append([
            mid,
            r["title"],
            num(r["startYear"], int),
            num(r["imdb_rating"], float),
            num(r["imdb_votes"], int),
            r["overview"],
            (r["poster_path"] or "").strip().lstrip("/"),
        ])
        emb += struct.pack(f"<{dim}f", *(float(r[c]) for c in emb_cols))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing.write_text(
        json.dumps({"dim": dim, "movies": movies}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT_DIR / "embeddings.bin").write_bytes(bytes(emb))
    live = sum(1 for m in movies if m)
    print(f"Wrote {live} movies ({len(movies)} slots, dim={dim}) to {OUT_DIR}")


if __name__ == "__main__":
    main()
