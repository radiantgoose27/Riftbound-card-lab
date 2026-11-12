"""Compute legend and card win-rate statistics and export JSON for the web app.

Outputs (under public/data/):
  meta.json                         periods, legends, generation time
  <period>/legends.json             per-legend win rates + play share
  <period>/matchups.json            legend vs legend matrix
  <period>/cards/<legend-slug>.json card inclusion effects for one legend

Card effect method, per (period, legend, card):
  population  matches played by decks of this legend that have a decklist,
              mirrors excluded
  in deck     the card appears in Mainboard, Champion or Battlefields
  raw         win rate with vs without the card
  adjusted    logistic regression
                result ~ has_card + opponent legend + player skill + top cut
                         (+ set period, for "All time")
              with standard errors clustered by deck, reported as the average
              change in predicted win rate (percentage points)
  q value     Benjamini-Hochberg within each (period, legend)

Player skill is a shrunk win rate over the player's matches in *other* events,
so a player's result in this event never feeds their own skill score.

Usage:  .venv/bin/python -m pipeline.analyze
"""
from __future__ import annotations

import json
import math
import re
import warnings
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "riftbound.duckdb"
OUT_DIR = ROOT.parent / "public" / "data"

SET_NAMES = {
    "OGN": "Origins",
    "SFD": "Spiritforged",
    "UNL": "Unleashed",
    "VEN": "Vendetta",
    "RAD": "Radiance",
}
DECK_SECTIONS = ("Mainboard", "Champion", "Battlefields")

MIN_LEGEND_DECKS = 25      # legend needs this many decklists in a period for card analysis
MIN_CARD_DECKS = 5         # card must appear in this many decks to be listed
MIN_SIDE_DECKS = 10        # decks on each side (with / without) to fit the model
MIN_SIDE_MATCHES = 40      # matches on each side to fit the model
MIN_OPP_MATCHES = 30       # opponent legends below this are pooled into "Other"
MIN_MATCHUP_MATCHES = 80   # legends below this are left out of the matchup grid
SKILL_PRIOR = 10           # pseudo-matches at 50% used to shrink player win rates

warnings.filterwarnings("ignore")


# ---------------------------------------------------------------- helpers

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def wilson(wins: float, n: float, z: float = 1.96) -> tuple[float | None, float | None]:
    if n <= 0:
        return None, None
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return round(centre - half, 4), round(centre + half, 4)


def r4(x) -> float | None:
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), 4)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), default=str))


# ---------------------------------------------------------------- periods

def detect_periods(con) -> list[dict]:
    """A new period starts on the first event where a set's cards appear in >=3 decks."""
    hits = con.execute(
        """
        SELECT cs.set_code, min(start_date) AS first_seen
        FROM (
            SELECT dc.tid, cs.set_code, count(DISTINCT dc.player) AS n_decks
            FROM deck_cards dc JOIN card_sets cs USING (card)
            GROUP BY ALL
        ) cs JOIN events USING (tid)
        WHERE n_decks >= 3
        GROUP BY ALL
        """
    ).fetchall()
    starts: dict[str, date] = {code: d for code, d in hits if code in SET_NAMES}
    first_event = con.execute("SELECT min(start_date) FROM events").fetchone()[0]
    starts["OGN"] = first_event
    ordered = sorted(starts.items(), key=lambda kv: kv[1])
    periods = []
    for i, (code, start) in enumerate(ordered):
        end = ordered[i + 1][1] if i + 1 < len(ordered) else None
        periods.append({"id": slug(SET_NAMES[code]), "name": SET_NAMES[code], "start": start, "end": end})
    periods.append({"id": "all", "name": "All time", "start": first_event, "end": None})
    return periods


def in_period(df: pd.DataFrame, p: dict) -> pd.DataFrame:
    m = df["start_date"] >= p["start"]
    if p["end"] is not None:
        m &= df["start_date"] < p["end"]
    return df[m]


# ---------------------------------------------------------------- data

def load_frames(con):
    pm = con.execute(
        """
        SELECT tid, start_date, player, legend, opp_legend, has_decklist,
               result, is_top_cut
        FROM player_matches
        WHERE legend IS NOT NULL AND opp_legend IS NOT NULL
        """
    ).df()
    pm["start_date"] = pd.to_datetime(pm["start_date"]).dt.date

    # Leave-one-event-out skill
    by_ev = pm.groupby(["player", "tid"])["result"].agg(["sum", "count"]).reset_index()
    tot = by_ev.groupby("player")[["sum", "count"]].transform("sum")
    other_w = tot["sum"] - by_ev["sum"]
    other_n = tot["count"] - by_ev["count"]
    shrunk = (other_w + SKILL_PRIOR * 0.5) / (other_n + SKILL_PRIOR)
    by_ev["skill"] = np.log(shrunk / (1 - shrunk))
    pm = pm.merge(by_ev[["player", "tid", "skill"]], on=["player", "tid"], how="left")

    cards = con.execute(
        f"""
        SELECT tid, player, card, section, sum(copies) AS copies
        FROM deck_cards
        WHERE section IN {DECK_SECTIONS}
        GROUP BY ALL
        """
    ).df()
    decks = con.execute(
        "SELECT d.tid, d.player, d.legend, e.start_date FROM decks d JOIN events e USING (tid)"
    ).df()
    decks["start_date"] = pd.to_datetime(decks["start_date"]).dt.date
    return pm, cards, decks


# ---------------------------------------------------------------- legend-level

def legend_table(pm: pd.DataFrame, decks: pd.DataFrame) -> list[dict]:
    nm = pm[pm["legend"] != pm["opp_legend"]]
    g = nm.groupby("legend")["result"].agg(["sum", "count"])
    deck_counts = decks.groupby("legend").size()
    total_decks = max(int(deck_counts.sum()), 1)
    appearances = pm.groupby("legend").apply(lambda x: x[["tid", "player"]].drop_duplicates().shape[0])
    out = []
    for legend, row in g.iterrows():
        lo, hi = wilson(row["sum"], row["count"])
        nd = int(deck_counts.get(legend, 0))
        out.append(
            {
                "legend": legend,
                "slug": slug(legend),
                "matches": int(row["count"]),
                "win_rate": r4(row["sum"] / row["count"]),
                "ci": [lo, hi],
                "decklists": nd,
                "deck_share": r4(nd / total_decks),
                "appearances": int(appearances.get(legend, 0)),
                "card_analysis": nd >= MIN_LEGEND_DECKS,
            }
        )
    out.sort(key=lambda r: -r["matches"])
    return out


def matchup_table(pm: pd.DataFrame) -> dict:
    nm = pm[pm["legend"] != pm["opp_legend"]]
    counts = nm.groupby("legend").size()
    keep = counts[counts >= MIN_MATCHUP_MATCHES].sort_values(ascending=False).index.tolist()
    sub = nm[nm["legend"].isin(keep) & nm["opp_legend"].isin(keep)]
    g = sub.groupby(["legend", "opp_legend"])["result"].agg(["sum", "count"])
    cells = {}
    for (a, b), row in g.iterrows():
        cells.setdefault(a, {})[b] = {"n": int(row["count"]), "wr": r4(row["sum"] / row["count"])}
    return {"legends": keep, "cells": cells}


# ---------------------------------------------------------------- card-level

def base_design(df: pd.DataFrame) -> pd.DataFrame:
    opp_counts = df["opp_legend"].value_counts()
    common = opp_counts[opp_counts >= MIN_OPP_MATCHES].index
    opp = df["opp_legend"].where(df["opp_legend"].isin(common), "Other")
    dummies = pd.get_dummies(opp, prefix="opp", drop_first=True, dtype=float)
    # Period fixed effects matter only for "All time", where a card's set
    # would otherwise stand in for the meta it was played in.
    period_fe = pd.get_dummies(df["period"], prefix="period", drop_first=True, dtype=float)
    X = pd.concat(
        [
            pd.Series(1.0, index=df.index, name="const"),
            df["skill"].fillna(0.0).rename("skill"),
            df["is_top_cut"].astype(float).rename("top_cut"),
            dummies,
            period_fe,
        ],
        axis=1,
    )
    return X.loc[:, X.std(ddof=0).gt(0) | (X.columns == "const")]


def fit_card(X: pd.DataFrame, y: np.ndarray, has: np.ndarray, groups: np.ndarray):
    Xc = X.copy()
    Xc["has_card"] = has.astype(float)
    try:
        res = sm.Logit(y, Xc).fit(
            disp=0, maxiter=100, cov_type="cluster", cov_kwds={"groups": groups}
        )
    except Exception:
        return None
    if not res.mle_retvals.get("converged", False):
        return None
    beta = res.params["has_card"]
    se = res.bse["has_card"]
    if not (math.isfinite(beta) and math.isfinite(se)) or se <= 0:
        return None
    X1, X0 = Xc.copy(), Xc.copy()
    X1["has_card"], X0["has_card"] = 1.0, 0.0
    ame = float(np.mean(res.predict(X1) - res.predict(X0)))
    # Delta-method-free CI: scale the log-odds CI by the same marginal factor.
    scale = ame / beta if abs(beta) > 1e-9 else float(np.mean(res.predict(Xc) * (1 - res.predict(Xc))))
    return {
        "adj_delta": ame,
        "adj_ci": [(beta - 1.96 * se) * scale, (beta + 1.96 * se) * scale],
        "log_odds": beta,
        "p": float(res.pvalues["has_card"]),
    }


def card_table(pm_leg: pd.DataFrame, cards_leg: pd.DataFrame, n_decks: int) -> list[dict]:
    df = pm_leg[pm_leg["has_decklist"] & (pm_leg["legend"] != pm_leg["opp_legend"])]
    df = df[df["result"] != 0.5].reset_index(drop=True)
    if df.empty:
        return []
    df["deck"] = df["tid"] + "|" + df["player"]
    y = df["result"].to_numpy()
    groups = pd.factorize(df["deck"])[0]
    X = base_design(df)

    cards_leg = cards_leg.assign(deck=cards_leg["tid"] + "|" + cards_leg["player"])
    deck_set = set(df["deck"])
    cards_leg = cards_leg[cards_leg["deck"].isin(deck_set)]
    total_decks = len(deck_set)

    rows = []
    for (card, section), grp in cards_leg.groupby(["card", "section"]):
        copies_by_deck = grp.groupby("deck")["copies"].sum()
        n_with = len(copies_by_deck)
        if n_with < MIN_CARD_DECKS:
            continue
        copies = df["deck"].map(copies_by_deck).fillna(0).to_numpy()
        has = copies > 0
        n_without = total_decks - n_with
        m_with, m_without = int(has.sum()), int((~has).sum())
        wr_with = float(y[has].mean()) if m_with else None
        wr_without = float(y[~has].mean()) if m_without else None

        by_copies = {}
        for k in sorted(set(copies[has].astype(int))):
            sel = copies == k
            by_copies[str(k)] = {
                "decks": int((copies_by_deck == k).sum()),
                "matches": int(sel.sum()),
                "wr": r4(y[sel].mean()),
            }

        row = {
            "card": card,
            "section": section,
            "decks_with": n_with,
            "decks_without": n_without,
            "play_rate": r4(n_with / total_decks),
            "avg_copies": r4(copies_by_deck.mean()),
            "matches_with": m_with,
            "matches_without": m_without,
            "wr_with": r4(wr_with),
            "wr_without": r4(wr_without),
            "ci_with": list(wilson(y[has].sum(), m_with)),
            "ci_without": list(wilson(y[~has].sum(), m_without)),
            "raw_delta": r4(wr_with - wr_without) if wr_with is not None and wr_without is not None else None,
            "by_copies": by_copies,
            "adj_delta": None,
            "adj_ci": None,
            "p": None,
            "q": None,
            "fit": False,
        }
        if (
            n_with >= MIN_SIDE_DECKS
            and n_without >= MIN_SIDE_DECKS
            and m_with >= MIN_SIDE_MATCHES
            and m_without >= MIN_SIDE_MATCHES
        ):
            fit = fit_card(X, y, has, groups)
            if fit:
                row.update(
                    adj_delta=r4(fit["adj_delta"]),
                    adj_ci=[r4(fit["adj_ci"][0]), r4(fit["adj_ci"][1])],
                    p=fit["p"],
                    fit=True,
                )
        rows.append(row)

    fitted = [r for r in rows if r["fit"]]
    if fitted:
        _, q, _, _ = multipletests([r["p"] for r in fitted], method="fdr_bh")
        for r, qv in zip(fitted, q):
            r["q"] = r4(qv)
            r["p"] = r4(r["p"])
    rows.sort(key=lambda r: (not r["fit"], -(r["adj_delta"] or -9), -r["decks_with"]))
    return rows


# ---------------------------------------------------------------- main

def main() -> None:
    con = duckdb.connect(str(DB_PATH), read_only=True)
    periods = detect_periods(con)
    pm, cards, decks = load_frames(con)
    set_periods = [p for p in periods if p["id"] != "all"]
    pm["period"] = "?"
    for p in set_periods:
        pm.loc[in_period(pm, p).index, "period"] = p["id"]
    events = con.execute("SELECT tid, start_date FROM events").df()
    events["start_date"] = pd.to_datetime(events["start_date"]).dt.date

    meta_periods = []
    for p in periods:
        pm_p = in_period(pm, p)
        decks_p = in_period(decks, p)
        if decks_p.empty:
            continue
        pdir = OUT_DIR / p["id"]
        legends = legend_table(pm_p, decks_p)
        write_json(pdir / "legends.json", legends)
        write_json(pdir / "matchups.json", matchup_table(pm_p))

        cards_p = cards.merge(decks_p[["tid", "player", "legend"]], on=["tid", "player"])
        n_card_files = 0
        for leg in legends:
            if not leg["card_analysis"]:
                continue
            name = leg["legend"]
            table = card_table(
                pm_p[pm_p["legend"] == name], cards_p[cards_p["legend"] == name], leg["decklists"]
            )
            write_json(
                pdir / "cards" / f"{leg['slug']}.json",
                {"legend": name, "decklists": leg["decklists"], "cards": table},
            )
            n_card_files += 1

        meta_periods.append(
            {
                "id": p["id"],
                "name": p["name"],
                "start": p["start"],
                "end": p["end"],
                "events": int(in_period(events, p).shape[0]),
                "decklists": int(len(decks_p)),
                "matches": int(len(pm_p) // 2),
                "legends_with_cards": n_card_files,
            }
        )
        print(f"{p['name']:13s} decks {len(decks_p):5d}  legends {len(legends):3d}  card tables {n_card_files}")

    # Newest set first, "All time" last
    sets = [m for m in meta_periods if m["id"] != "all"][::-1]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "default_period": sets[0]["id"] if sets else "all",
        "periods": sets + [m for m in meta_periods if m["id"] == "all"],
        "thresholds": {
            "min_legend_decks": MIN_LEGEND_DECKS,
            "min_card_decks": MIN_CARD_DECKS,
            "min_side_decks": MIN_SIDE_DECKS,
            "min_side_matches": MIN_SIDE_MATCHES,
        },
    }
    write_json(OUT_DIR / "meta.json", meta)


if __name__ == "__main__":
    main()
