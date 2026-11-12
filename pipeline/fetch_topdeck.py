"""Download Riftbound tournaments (standings, decklists, rounds) from the TopDeck.gg API.

Raw responses are cached under pipeline/data/raw/topdeck/ as one JSON file per
time window, so re-running only fetches windows that are missing (plus the most
recent window, which may still be filling in).

Usage:  .venv/bin/python -m pipeline.fetch_topdeck [--since 2025-06-01] [--days 30]
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw" / "topdeck"
ENV_FILE = ROOT.parent / ".env"
API = "https://topdeck.gg/api"
POST_INTERVAL_S = 13  # TopDeck allows 5 POST requests/minute


def api_key() -> str:
    key = (dotenv_values(ENV_FILE).get("TOPDECK_API_KEY") or "").strip()
    if not key:
        raise SystemExit("TOPDECK_API_KEY is missing from .env")
    return key


def windows(since: datetime, until: datetime, days: int):
    start = since
    while start < until:
        end = min(start + timedelta(days=days), until)
        yield start, end
        start = end


def fetch_window(client: httpx.Client, start: datetime, end: datetime) -> list[dict]:
    body = {
        "game": "Riftbound",
        "format": "Constructed",
        "start": int(start.timestamp()),
        "end": int(end.timestamp()),
        "columns": ["id", "decklist", "wins", "losses", "draws"],
        "rounds": True,
    }
    for attempt in range(5):
        r = client.post("/v2/tournaments", json=body)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 60))
            print(f"  rate limited, sleeping {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("gave up after repeated rate limiting")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2025-06-01", help="UTC date to start from")
    ap.add_argument("--days", type=int, default=30, help="window size in days")
    args = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    wins = list(windows(since, now, args.days))

    client = httpx.Client(
        base_url=API,
        headers={"Authorization": api_key(), "User-Agent": "riftbound-stats/0.1"},
        timeout=180,
    )
    last_post = 0.0
    for i, (start, end) in enumerate(wins):
        out = RAW_DIR / f"{start:%Y%m%d}_{end:%Y%m%d}.json"
        is_latest = i == len(wins) - 1
        if out.exists() and not is_latest:
            continue
        # Replace the stale partial file for the open-ended latest window.
        for stale in RAW_DIR.glob(f"{start:%Y%m%d}_*.json"):
            stale.unlink()
        wait = POST_INTERVAL_S - (time.monotonic() - last_post)
        if wait > 0:
            time.sleep(wait)
        last_post = time.monotonic()
        data = fetch_window(client, start, end)
        out.write_text(json.dumps(data))
        n_decks = sum(
            1 for t in data for p in (t.get("standings") or []) if p.get("deckObj")
        )
        print(f"{start:%Y-%m-%d} → {end:%Y-%m-%d}: {len(data)} events, {n_decks} decklists")


if __name__ == "__main__":
    main()
