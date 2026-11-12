import numpy as np
import pandas as pd

from pipeline.analyze import fit_card, slug, wilson
from pipeline.build_db import anon, normalize, parse_round


def _event():
    deck = lambda legend, extra: {  # noqa: E731
        "metadata": {"game": "Riftbound", "format": "Constructed"},
        "Legend": {legend: {"id": "OGN-001", "count": 1}},
        "Main Deck": {"Card A": {"id": "OGN-010", "count": 2}, **extra},
        "Rune Pool": {"Fury Rune": {"id": "OGN-007", "count": 12}},
    }
    return {
        "TID": "t1",
        "tournamentName": "Test",
        "startDate": 1790000000,
        "swissNum": 3,
        "topCut": 0,
        "standings": [
            {"id": "p1", "deckObj": deck("Leg X", {"Card B": {"id": "RAD-001", "count": 3}})},
            {"id": "p2", "deckObj": deck("Leg Y", {})},
            {"id": "p3", "deckObj": None},
        ],
        "rounds": [
            {"round": 1, "tables": [{
                "table": 1, "status": "Completed",
                "players": [{"name": "A", "id": "p1", "leader": "Leg X"},
                            {"name": "B", "id": "p2", "leader": "Leg Y"}],
                "winner": "B", "winner_id": None,  # resolved by name
            }]},
            {"round": "Top 4", "tables": []},
        ],
    }


def test_normalize_handles_aliases_missing_winner_id_and_set_codes():
    events, decks, cards, matches, card_sets = normalize([_event()])
    assert len(decks) == 2  # p3 has no decklist
    assert set(cards["section"]) == {"Legend", "Mainboard", "Runes"}
    assert matches.loc[0, "winner"] == anon("p2")
    assert dict(zip(card_sets["card"], card_sets["set_code"]))["Card B"] == "RAD"
    assert "p1" not in set(decks["player"])  # ids are hashed


def test_parse_round():
    assert parse_round(3) == (3, "3", False)
    assert parse_round("Top 8") == (None, "Top 8", True)


def test_wilson_and_slug():
    lo, hi = wilson(50, 100)
    assert lo < 0.5 < hi and abs((0.5 - lo) - (hi - 0.5)) < 1e-9
    assert wilson(0, 0) == (None, None)
    assert slug("Kai'Sa, Daughter of the Void") == "kai-sa-daughter-of-the-void"


def test_fit_card_recovers_positive_effect():
    rng = np.random.default_rng(0)
    n_decks, per_deck = 300, 5
    has_deck = rng.random(n_decks) < 0.5
    has = np.repeat(has_deck, per_deck)
    groups = np.repeat(np.arange(n_decks), per_deck)
    p = np.where(has, 0.60, 0.45)
    y = (rng.random(len(p)) < p).astype(float)
    X = pd.DataFrame({"const": np.ones(len(y))})
    fit = fit_card(X, y, has, groups)
    assert fit is not None
    assert 0.05 < fit["adj_delta"] < 0.25
    assert 0.01 < fit["adj_se"] < 0.08
