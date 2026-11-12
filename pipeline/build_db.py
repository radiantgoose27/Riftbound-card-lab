"""Normalize cached TopDeck responses into a DuckDB database.

Tables
  events      one row per tournament
  decks       one row per (event, player) with a structured decklist
  deck_cards  one row per (event, player, section, card)
  matches     one row per completed 1v1 table
  player_matches (view)  each match from both players' perspective, with legends

Player IDs are replaced with a salted hash; names are never stored.

Usage:  .venv/bin/python -m pipeline.build_db
"""
from __future__ import annotations

import glob
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw" / "topdeck"
DB_PATH = ROOT / "data" / "riftbound.duckdb"

SECTION_ALIASES = {
    "Main Deck": "Mainboard",
    "Rune Pool": "Runes",
    "Additional Legends": "Legend",
}
SKIP_SECTIONS = {"metadata"}
SET_ORDER = ["OGN", "OGS", "SFD", "UNL", "VEN", "RAD"]  # release order


def anon(player_id: str | None) -> str | None:
    if not player_id:
        return None
    return hashlib.sha256(f"riftbound-stats:{player_id}".encode()).hexdigest()[:16]


def load_events() -> list[dict]:
    seen: dict[str, dict] = {}
    for f in sorted(glob.glob(str(RAW_DIR / "*.json"))):
        for t in json.loads(Path(f).read_text()):
            seen[t["TID"]] = t  # later windows win on duplicates
    return list(seen.values())


def parse_round(label) -> tuple[int | None, str, bool]:
    """Return (swiss round number or None, label, is_top_cut)."""
    s = str(label)
    if s.isdigit():
        return int(s), s, False
    return None, s, True


def normalize(events: list[dict]):
    ev_rows, deck_rows, card_rows, match_rows = [], [], [], []
    card_set: dict[str, str] = {}  # card name -> earliest set code it was printed in
    for t in events:
        tid = t["TID"]
        standings = t.get("standings") or []
        ev_rows.append(
            {
                "tid": tid,
                "name": t.get("tournamentName"),
                "start_date": datetime.fromtimestamp(t["startDate"], timezone.utc).date(),
                "swiss_rounds": t.get("swissNum"),
                "top_cut": t.get("topCut"),
                "n_players": len(standings),
            }
        )
        for p in standings:
            d = p.get("deckObj")
            pid = anon(p.get("id"))
            if not d or not pid:
                continue
            legend = next(iter(d.get("Legend") or {}), None)
            champion = next(iter(d.get("Champion") or {}), None)
            if not legend:
                continue
            deck_rows.append(
                {
                    "tid": tid,
                    "player": pid,
                    "legend": legend,
                    "champion": champion,
                    "wins": p.get("wins"),
                    "losses": p.get("losses"),
                    "draws": p.get("draws"),
                }
            )
            agg: dict[tuple[str, str], int] = {}
            for section, cards in d.items():
                if section in SKIP_SECTIONS or not isinstance(cards, dict):
                    continue
                section = SECTION_ALIASES.get(section, section)
                for name, info in cards.items():
                    if not isinstance(info, dict):
                        continue
                    code = str(info.get("id", ""))[:3]
                    if code in SET_ORDER:
                        prev = card_set.get(name.strip())
                        if prev is None or SET_ORDER.index(code) < SET_ORDER.index(prev):
                            card_set[name.strip()] = code
                    key = (section, name.strip())
                    agg[key] = agg.get(key, 0) + int(info.get("count") or 0)
            for (section, name), count in agg.items():
                card_rows.append(
                    {"tid": tid, "player": pid, "section": section, "card": name, "copies": count}
                )

        for r in t.get("rounds") or []:
            rnum, rlabel, top_cut = parse_round(r["round"])
            for tb in r.get("tables") or []:
                players = tb.get("players") or []
                if len(players) != 2 or tb.get("status") != "Completed":
                    continue
                a, b = players
                if not a.get("id") or not b.get("id"):
                    continue
                winner_id = tb.get("winner_id")
                if not winner_id and tb.get("winner"):
                    named = [p for p in players if p.get("name") == tb["winner"]]
                    if len(named) == 1:
                        winner_id = named[0]["id"]
                match_rows.append(
                    {
                        "tid": tid,
                        "round_num": rnum,
                        "round_label": rlabel,
                        "is_top_cut": top_cut,
                        "table_no": tb.get("table"),
                        "p1": anon(a["id"]),
                        "p2": anon(b["id"]),
                        "p1_leader": a.get("leader"),
                        "p2_leader": b.get("leader"),
                        "winner": anon(winner_id),  # NULL = draw / unknown
                        "winner_games": tb.get("winner_games"),
                        "loser_games": tb.get("loser_games"),
                    }
                )
    return (
        pd.DataFrame(ev_rows),
        pd.DataFrame(deck_rows).drop_duplicates(["tid", "player"]),
        pd.DataFrame(card_rows),
        pd.DataFrame(match_rows),
        pd.DataFrame(sorted(card_set.items()), columns=["card", "set_code"]),
    )


def build() -> duckdb.DuckDBPyConnection:
    events, decks, cards, matches, card_sets = normalize(load_events())
    DB_PATH.unlink(missing_ok=True)
    con = duckdb.connect(str(DB_PATH))
    tables = [("events", events), ("decks", decks), ("deck_cards", cards),
              ("matches", matches), ("card_sets", card_sets)]
    for name, df in tables:
        con.register("df", df)
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM df")
        con.unregister("df")

    # Each match from both sides. The legend comes from the decklist when one
    # exists, otherwise from the table's `leader` field.
    con.execute(
        """
        CREATE VIEW player_matches AS
        WITH sides AS (
            SELECT tid, round_num, round_label, is_top_cut, p1 AS player, p2 AS opponent,
                   p1_leader AS leader, p2_leader AS opp_leader, winner, winner_games, loser_games
            FROM matches
            UNION ALL
            SELECT tid, round_num, round_label, is_top_cut, p2, p1,
                   p2_leader, p1_leader, winner, winner_games, loser_games
            FROM matches
        )
        SELECT s.tid, e.start_date, s.round_num, s.round_label, s.is_top_cut,
               s.player, s.opponent,
               coalesce(d.legend, s.leader) AS legend,
               coalesce(od.legend, s.opp_leader) AS opp_legend,
               d.player IS NOT NULL AS has_decklist,
               CASE WHEN s.winner IS NULL THEN 0.5
                    WHEN s.winner = s.player THEN 1.0 ELSE 0.0 END AS result
        FROM sides s
        JOIN events e USING (tid)
        LEFT JOIN decks d ON d.tid = s.tid AND d.player = s.player
        LEFT JOIN decks od ON od.tid = s.tid AND od.player = s.opponent
        """
    )
    return con


def main() -> None:
    con = build()
    for t in ["events", "decks", "deck_cards", "matches"]:
        print(f"{t:12s} {con.execute(f'SELECT count(*) FROM {t}').fetchone()[0]:>8,}")
    print(
        "player-matches with decklist:",
        f"{con.execute('SELECT count(*) FROM player_matches WHERE has_decklist').fetchone()[0]:,}",
    )


if __name__ == "__main__":
    main()
