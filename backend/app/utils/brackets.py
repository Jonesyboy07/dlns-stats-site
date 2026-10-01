"""Bracket structure for tournament events.

An event holds rounds and series. Each series is one Team A vs Team B set made
of games (Deadlock match IDs), and may link its winner (and loser) into a slot
of a later series. Formats only differ in how the empty series and their links
are generated; scores, winners and advancement are always computed from game
results, never stored.

Everything here is pure: no Flask, no database. Game results come in as a
``{match_id: "team_a" | "team_b"}`` map built by the caller.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Dict, Iterable, List, Optional

BYE = "BYE"
SLOTS = ("team_a", "team_b")
FORMATS = ("gauntlet", "single_elim")


def _other(slot: str) -> str:
    return "team_b" if slot == "team_a" else "team_a"


def _clean_teams(teams: Iterable[Any]) -> List[str]:
    return [str(t).strip() for t in teams if str(t or "").strip()]


def _series(series_id: str, round_no: int, team_a: Optional[str], team_b: Optional[str]) -> Dict[str, Any]:
    return {
        "id": series_id,
        "round": round_no,
        "team_a": team_a,
        "team_b": team_b,
        "winner_to": None,
        "loser_to": None,
        "vod": "",
        "games": [],
        "outcome": None,
    }


def generate_gauntlet(teams: Iterable[Any], round_names: Iterable[Any], best_of: Iterable[Any]) -> Dict[str, Any]:
    """Ladder where each round's winner meets the next seed up.

    Seed 1 (the defending champion) waits in the last round, seed 2 in the one
    before it, and the two lowest seeds open round 1. With rounds
    Qualifiers, Challenger, Finals that needs 4 teams.
    """
    names = [str(n).strip() for n in round_names if str(n or "").strip()]
    if not names:
        raise ValueError("A gauntlet needs at least one round.")
    bos = [int(b) for b in best_of]
    if len(bos) != len(names):
        raise ValueError("Give one best-of per round.")
    n = len(names)
    seeds = _clean_teams(teams)
    if seeds and len(seeds) != n + 1:
        raise ValueError(f"{n} rounds need {n + 1} teams (got {len(seeds)}).")

    def seed(i: int) -> Optional[str]:
        return seeds[i - 1] if seeds else None

    rounds = [{"round": r, "name": names[r - 1], "best_of": bos[r - 1]} for r in range(1, n + 1)]
    series = []
    for r in range(1, n + 1):
        # Round r's resident team is seed (n + 1 - r); round 1 also takes the lowest seed.
        team_a = seed(n + 1 - r)
        team_b = seed(n + 1) if r == 1 else None
        s = _series(f"R{r}M1", r, team_a, team_b)
        if r < n:
            s["winner_to"] = {"series": f"R{r + 1}M1", "slot": "team_b"}
        series.append(s)
    return {"format": "gauntlet", "rounds": rounds, "series": series}


def _seed_order(size: int) -> List[int]:
    """Standard bracket seeding: 1v16, 8v9, 5v12, 4v13, ... for size 16."""
    order = [1]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [x for s in order for x in (s, total - s)]
    return order


def _elim_round_name(round_no: int, total_rounds: int) -> str:
    from_end = total_rounds - round_no
    if from_end == 0:
        return "Final"
    if from_end == 1:
        return "Semifinals"
    if from_end == 2:
        return "Quarterfinals"
    return f"Round {round_no}"


def generate_single_elim(teams: Iterable[Any], best_of: Iterable[Any]) -> Dict[str, Any]:
    """Single elimination for any team count, padded with byes to a power of 2."""
    seeds = _clean_teams(teams)
    if len(seeds) < 2:
        raise ValueError("Single elimination needs at least 2 teams.")
    size = 1 << math.ceil(math.log2(len(seeds)))
    total_rounds = int(math.log2(size))
    bos = [int(b) for b in best_of]
    if len(bos) == 1:
        bos = bos * total_rounds
    if len(bos) != total_rounds:
        raise ValueError(f"Give one best-of, or one per round ({total_rounds}).")

    rounds = [
        {"round": r, "name": _elim_round_name(r, total_rounds), "best_of": bos[r - 1]}
        for r in range(1, total_rounds + 1)
    ]

    def team(seed_no: int) -> str:
        return seeds[seed_no - 1] if seed_no <= len(seeds) else BYE

    order = _seed_order(size)
    series = []
    for r in range(1, total_rounds + 1):
        count = size >> r
        for m in range(1, count + 1):
            if r == 1:
                s = _series(f"R1M{m}", 1, team(order[2 * m - 2]), team(order[2 * m - 1]))
            else:
                s = _series(f"R{r}M{m}", r, None, None)
            if r < total_rounds:
                s["winner_to"] = {
                    "series": f"R{r + 1}M{(m + 1) // 2}",
                    "slot": "team_a" if m % 2 == 1 else "team_b",
                }
            series.append(s)
    return {"format": "single_elim", "rounds": rounds, "series": series}


def generate(fmt: str, teams: Iterable[Any], round_names: Iterable[Any] = (), best_of: Iterable[Any] = (1,)) -> Dict[str, Any]:
    if fmt == "gauntlet":
        return generate_gauntlet(teams, round_names, best_of)
    if fmt == "single_elim":
        return generate_single_elim(teams, best_of)
    raise ValueError(f"Unknown format {fmt!r}. Supported: {', '.join(FORMATS)}.")


def _game_winner(game: Dict[str, Any], results: Dict[int, str]) -> Optional[str]:
    """Winner slot of one game: a manual winner (forfeits), else the API result."""
    manual = game.get("winner")
    if manual in SLOTS:
        return manual
    try:
        return results.get(int(game.get("match_id")))
    except (TypeError, ValueError):
        return None


def compute(event: Dict[str, Any], results: Dict[int, str]) -> Dict[str, Any]:
    """Return a copy of ``event`` with scores, winners and advanced teams filled in.

    Each series gains ``score_a``, ``score_b``, ``winner`` (slot or None),
    ``winner_name`` and ``status``: pending, live, done, dq or bye. Teams fed
    from an earlier series are written into ``team_a``/``team_b`` of the copy,
    with ``fed_a``/``fed_b`` marking which ones were filled automatically.
    """
    out = copy.deepcopy(event)
    rounds = {r["round"]: r for r in out.get("rounds") or []}
    by_id = {s["id"]: s for s in out.get("series") or []}

    for s in sorted(by_id.values(), key=lambda x: (x.get("round", 0), x["id"])):
        best_of = int(s.get("best_of") or rounds.get(s.get("round"), {}).get("best_of") or 1)
        need = best_of // 2 + 1
        outcome = s.get("outcome") or None

        score = {"team_a": 0, "team_b": 0}
        for idx, game in enumerate(s.get("games") or [], start=1):
            if outcome and outcome.get("type") == "dq":
                after = int(outcome.get("after_game") or 0)
                if idx > after or outcome.get("played_games") == "void":
                    continue
            w = _game_winner(game, results)
            if w:
                score[w] += 1

        winner: Optional[str] = None
        status = "pending"
        if outcome and outcome.get("type") == "dq" and outcome.get("team") in SLOTS:
            winner = _other(outcome["team"])
            status = "dq"
        elif s.get("team_a") == BYE or s.get("team_b") == BYE:
            if s.get("team_a") and s.get("team_b"):
                winner = "team_b" if s.get("team_a") == BYE else "team_a"
                status = "bye"
        elif score["team_a"] >= need:
            winner, status = "team_a", "done"
        elif score["team_b"] >= need:
            winner, status = "team_b", "done"
        elif score["team_a"] or score["team_b"] or s.get("games"):
            status = "live"

        s["best_of"] = best_of
        s["score_a"] = score["team_a"]
        s["score_b"] = score["team_b"]
        s["winner"] = winner
        s["winner_name"] = s.get(winner) if winner else None
        s["status"] = status

        for link_key, slot_of in (("winner_to", winner), ("loser_to", _other(winner) if winner else None)):
            link = s.get(link_key)
            if not link or not slot_of:
                continue
            target = by_id.get(link.get("series"))
            if target is None or link.get("slot") not in SLOTS:
                continue
            if not target.get(link["slot"]):
                target[link["slot"]] = s.get(slot_of)
                target["fed_a" if link["slot"] == "team_a" else "fed_b"] = True

    return out


def match_ids(event: Dict[str, Any]) -> List[int]:
    ids: List[int] = []
    for s in event.get("series") or []:
        for g in s.get("games") or []:
            try:
                mid = int(g.get("match_id"))
            except (TypeError, ValueError):
                continue
            if mid > 0:
                ids.append(mid)
    return ids
