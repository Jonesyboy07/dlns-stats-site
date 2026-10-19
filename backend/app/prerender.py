"""Crawlable content for the React shell's key public pages.

The site is a client-rendered React SPA. ``templates/react.html`` can therefore
show crawlers (and no-JS visitors) very little before the bundle runs. This
module renders a compact, server-side snapshot of the important page types —
match, player, hero, team and week — into ``#root``. React replaces that markup
on mount, so users see the normal app while crawlers get real text, headings and
internal links in the initial response.
"""

from __future__ import annotations

import html
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, unquote

from flask import Flask, current_app, has_request_context, request

from .heroes import get_hero_name
from .seo import _canonical_path

_CACHE_TTL_SECONDS = 300
_MAX_CACHE_ENTRIES = 2000
_cache: dict[str, tuple[float, str]] = {}

_MATCH_RE = re.compile(r"^/matches?/(\d+)$")
_PLAYER_RE = re.compile(r"^/player/(\d+)$")
_PLAYER_HERO_RE = re.compile(r"^/player/(\d+)/hero/(\d+)$")
_HERO_RE = re.compile(r"^/hero/(\d+)$")
_TEAM_RE = re.compile(r"^/team/(.+)$")
_WEEK_RE = re.compile(r"^/week/(\d+)$")
_INTERVIEW_RE = re.compile(r"^/interviews/([^/]+)$")

_TABLE_LIMIT = 10


def _enabled() -> bool:
    configured = current_app.config.get("SEO_PRERENDER", os.getenv("SEO_PRERENDER", "1"))
    return str(configured).strip().lower() not in {"0", "false", "no", "off"}


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _link(href: str, text: Any) -> str:
    return f'<a href="{_esc(href)}">{_esc(text)}</a>'


def _rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    from .blueprints.db_api import get_ro_conn

    conn = get_ro_conn()
    try:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(sql, params).fetchall()]
    except Exception:
        return []
    finally:
        conn.close()


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _fmt_int(value: Any) -> str:
    number = _int(value)
    return f"{number:,}" if number is not None else "—"


def _count(value: Any, singular: str, plural: str | None = None) -> str:
    number = _int(value) or 0
    word = singular if number == 1 else (plural or f"{singular}s")
    return f"{number:,} {word}"


def _fmt_pct(part: Any, total: Any) -> str:
    numerator, denominator = _int(part), _int(total)
    if not denominator:
        return "—"
    return f"{100 * numerator / denominator:.1f}%"


def _fmt_duration(value: Any) -> str:
    seconds = _int(value)
    if seconds is None:
        return "—"
    return f"{seconds // 60}:{seconds % 60:02d}"


def _fmt_date(value: Any) -> str:
    if value is None:
        return "—"
    try:
        text = str(value).strip()
        if text.isdigit():
            moment = datetime.fromtimestamp(float(text), tz=timezone.utc)
        else:
            moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return moment.strftime("%d %b %Y")
    except (TypeError, ValueError, OSError):
        return str(value)


def _table(headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    head = "".join(f"<th>{_esc(header)}</th>" for header in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _section(heading: str, body: str) -> str:
    if not body:
        return ""
    return f"<section><h2>{_esc(heading)}</h2>{body}</section>"


def _crumb_nav(items: list[tuple[str, str]] | None) -> str:
    if not items:
        return ""
    parts = [
        f'<span aria-current="page">{_esc(name)}</span>'
        if index == len(items) - 1
        else _link(path, name)
        for index, (name, path) in enumerate(items)
    ]
    return (
        '<nav class="prerender-breadcrumb" aria-label="Breadcrumb">'
        + " / ".join(parts)
        + "</nav>"
    )


def _article(
    kind: str,
    h1: str,
    intro: str,
    body: str,
    footer: str = "",
    crumbs: list[tuple[str, str]] | None = None,
) -> str:
    return (
        f'<article class="prerender prerender-{_esc(kind)}">'
        f"{_crumb_nav(crumbs)}<h1>{h1}</h1><p>{intro}</p>{body}{footer}</article>"
    )


def _side_teams(match: dict[str, Any]) -> dict[int, str]:
    team_a = match.get("event_team_a")
    team_b = match.get("event_team_b")
    side_a = _int(match.get("event_team_a_ingame_side"))
    if side_a in (0, 1) and team_a and team_b:
        return {side_a: str(team_a), 1 - side_a: str(team_b)}
    return {0: str(team_a or "Amber"), 1: str(team_b or "Sapphire")}


def _winner_name(match: dict[str, Any]) -> str | None:
    side = _int(match.get("winning_team"))
    if side not in (0, 1):
        return None
    return _side_teams(match).get(side)


def _team_href(name: str) -> str:
    return f"/team/{quote(name, safe='')}"


def _match_query(match_id: int) -> dict[str, Any] | None:
    rows = _rows(
        "SELECT match_id, duration_s, winning_team, event_title, event_week, "
        "event_team_a, event_team_b, event_game, event_team_a_ingame_side, "
        "event_region, start_time, created_at FROM matches WHERE match_id = ?",
        (match_id,),
    )
    return rows[0] if rows else None


def _match_context(match: dict[str, Any]) -> str:
    pieces = []
    if match.get("event_title"):
        pieces.append(str(match["event_title"]))
    if match.get("event_week") is not None:
        pieces.append(f"Week {match['event_week']}")
    if match.get("event_game"):
        pieces.append(str(match["event_game"]))
    if match.get("event_region"):
        pieces.append(str(match["event_region"]))
    return " · ".join(pieces)


def _match_page(match_id: int) -> str:
    match = _match_query(match_id)
    if not match:
        return ""

    teams = _side_teams(match)
    team_a = match.get("event_team_a")
    team_b = match.get("event_team_b")
    heading = (
        f"{_esc(team_a)} vs {_esc(team_b)}"
        if team_a and team_b
        else f"Match {_esc(match_id)}"
    )
    winner = _winner_name(match)
    intro_bits = [bit for bit in (_match_context(match), _fmt_date(match.get("start_time") or match.get("created_at"))) if bit]
    intro = " · ".join(_esc(bit) for bit in intro_bits)
    if winner:
        intro += f" · {_esc(winner)} won"
    if match.get("duration_s"):
        intro += f" in {_esc(_fmt_duration(match['duration_s']))}"

    players = _rows(
        "SELECT p.team, p.account_id, p.hero_id, p.kills, p.deaths, p.assists, "
        "p.net_worth, p.player_damage, p.result, u.persona_name "
        "FROM players p LEFT JOIN users u ON u.account_id = p.account_id "
        "WHERE p.match_id = ? ORDER BY p.team, p.player_slot",
        (match_id,),
    )

    sections = []
    for side in (0, 1):
        side_rows = [row for row in players if _int(row.get("team")) == side]
        if not side_rows:
            continue
        rows = []
        for row in side_rows:
            persona = row.get("persona_name") or f"Player {row.get('account_id')}"
            hero = get_hero_name(_int(row.get("hero_id")))
            rows.append(
                [
                    _link(f"/player/{row['account_id']}", persona),
                    _link(f"/hero/{row['hero_id']}", hero),
                    _esc(f"{_fmt_int(row.get('kills'))}/{_fmt_int(row.get('deaths'))}/{_fmt_int(row.get('assists'))}"),
                    _esc(_fmt_int(row.get("net_worth"))),
                    _esc(_fmt_int(row.get("player_damage"))),
                    _esc(row.get("result") or "—"),
                ]
            )
        table = _table(
            ["Player", "Hero", "K/D/A", "Souls", "Damage", "Result"], rows
        )
        sections.append(
            f"<h3>{_esc(teams.get(side, f'Team {side + 1}'))}</h3>{table}"
        )

    footer_links = []
    if match.get("event_week") is not None:
        footer_links.append(
            _link(f"/week/{match['event_week']}", f"Week {match['event_week']} results")
        )
    footer_links.append(_link(f"/series/{match_id}", "Series overview"))
    for name in (team_a, team_b):
        if name:
            footer_links.append(_link(_team_href(str(name)), f"{name} team page"))
    footer = f"<p>{' · '.join(footer_links)}</p>" if footer_links else ""

    label = f"{team_a} vs {team_b}" if team_a and team_b else f"Match {match_id}"
    crumbs = [("Home", "/")]
    if match.get("event_week") is not None:
        crumbs.append(
            (f"Night Shift Week {match['event_week']}", f"/week/{match['event_week']}")
        )
    crumbs.append((label, f"/matches/{match_id}"))

    return _article(
        "match",
        heading,
        intro or "Deadlock match details.",
        "".join(sections),
        footer,
        crumbs=crumbs,
    )


def _recent_matches_table(
    rows: list[dict[str, Any]],
    account_id: int | None = None,
    team_name: str | None = None,
) -> str:
    table_rows = []
    for row in rows:
        teams = _side_teams(row)
        opponent = ""
        if account_id is not None:
            side = _int(row.get("player_team"))
            if side in (0, 1):
                opponent = teams.get(1 - side, "")
        elif team_name:
            opponent = next(
                (
                    name
                    for name in teams.values()
                    if name and name.lower() != team_name.lower()
                ),
                "",
            )
        matchup = " vs ".join(part for part in (teams.get(0), teams.get(1)) if part)
        link = _link(f"/matches/{row['match_id']}", matchup or f"Match {row['match_id']}")
        values = [
            _esc(_fmt_date(row.get("start_time") or row.get("created_at"))),
            link,
            _esc(row.get("event_game") or "—"),
        ]
        if account_id is not None or team_name:
            values.append(_esc(opponent or "—"))
        values.extend(
            [
                _esc(_winner_name(row) or "—"),
                _link(f"/series/{row['match_id']}", "Series"),
            ]
        )
        table_rows.append(values)
    headers = ["Date", "Match", "Game"]
    if account_id is not None or team_name:
        headers.append("Opponent")
    headers.extend(["Winner", "Series"])
    return _table(headers, table_rows)


def _player_aggregate(account_id: int) -> dict[str, Any] | None:
    rows = _rows(
        "SELECT COUNT(*) games, "
        "SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) wins, "
        "SUM(kills) kills, SUM(deaths) deaths, SUM(assists) assists, "
        "AVG(net_worth) avg_souls "
        "FROM players WHERE account_id = ?",
        (account_id,),
    )
    if not rows or not _int(rows[0].get("games")):
        return None
    return rows[0]


def _player_matches(account_id: int, hero_id: int | None = None) -> list[dict[str, Any]]:
    sql = (
        "SELECT p.match_id, p.hero_id, p.kills, p.deaths, p.assists, p.net_worth, "
        "p.result, p.team AS player_team, m.event_title, m.event_week, "
        "m.event_team_a, m.event_team_b, m.event_game, "
        "m.event_team_a_ingame_side, m.winning_team, m.start_time, m.created_at "
        "FROM players p JOIN matches m ON m.match_id = p.match_id "
        "WHERE p.account_id = ?"
    )
    params: tuple = (account_id,)
    if hero_id is not None:
        sql += " AND p.hero_id = ?"
        params += (hero_id,)
    sql += " ORDER BY m.match_id DESC LIMIT ?"
    params += (_TABLE_LIMIT,)
    return _rows(sql, params)


def _player_page(account_id: int) -> str:
    users = _rows(
        "SELECT account_id, persona_name FROM users WHERE account_id = ?",
        (account_id,),
    )
    if not users:
        return ""
    persona = users[0].get("persona_name") or f"Player {account_id}"
    aggregate = _player_aggregate(account_id)
    if not aggregate:
        return _article(
            "player",
            _esc(persona),
            f"{_esc(persona)} has no Night Shift games on record.",
            "",
            f"<p>{_link('/players', 'All players')}</p>",
            crumbs=[("Home", "/"), ("Players", "/players"), (persona, f"/player/{account_id}")],
        )

    games = _int(aggregate.get("games")) or 0
    wins = _int(aggregate.get("wins")) or 0
    intro = (
        f"Deadlock Night Shift player profile: {_count(games, 'game')}, "
        f"{_count(wins, 'win')} ({_fmt_pct(wins, games)}), "
        f"{_fmt_int((_int(aggregate.get('kills')) or 0) + (_int(aggregate.get('assists')) or 0))} kills + assists."
    )

    hero_rows = _rows(
        "SELECT hero_id, COUNT(*) games, "
        "SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players WHERE account_id = ? GROUP BY hero_id "
        "ORDER BY games DESC LIMIT 8",
        (account_id,),
    )
    hero_table = _table(
        ["Hero", "Games", "Wins", "Win rate"],
        [
            [
                _link(f"/player/{account_id}/hero/{row['hero_id']}", get_hero_name(_int(row.get("hero_id")))),
                _esc(_fmt_int(row.get("games"))),
                _esc(_fmt_int(row.get("wins"))),
                _esc(_fmt_pct(row.get("wins"), row.get("games"))),
            ]
            for row in hero_rows
        ],
    )

    matches = _recent_matches_table(_player_matches(account_id), account_id=account_id)
    body = _section("Hero pool", hero_table) + _section("Recent matches", matches)
    footer = f"<p>{_link('/players', 'All players')} · {_link('/week', 'Night Shift weeks')}</p>"
    return _article(
        "player",
        _esc(persona),
        intro,
        body,
        footer,
        crumbs=[("Home", "/"), ("Players", "/players"), (persona, f"/player/{account_id}")],
    )


def _player_hero_page(account_id: int, hero_id: int) -> str:
    users = _rows(
        "SELECT persona_name FROM users WHERE account_id = ?", (account_id,)
    )
    persona = (users[0].get("persona_name") if users else None) or f"Player {account_id}"
    hero = get_hero_name(hero_id)

    stats = _rows(
        "SELECT COUNT(*) games, SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players WHERE account_id = ? AND hero_id = ?",
        (account_id, hero_id),
    )
    games = _int(stats[0].get("games")) if stats else 0
    wins = _int(stats[0].get("wins")) if stats else 0
    intro = (
        f"{_esc(persona)} on {_esc(hero)}: {_count(games, 'Night Shift game')}, "
        f"{_count(wins, 'win')} ({_fmt_pct(wins, games)})."
    )
    matches = _recent_matches_table(
        _player_matches(account_id, hero_id=hero_id), account_id=account_id
    )
    footer = (
        f"<p>{_link(f'/player/{account_id}', f'{persona} profile')} · "
        f"{_link(f'/hero/{hero_id}', f'{hero} stats')}</p>"
    )
    return _article(
        "player-hero",
        f"{_esc(persona)} on {_esc(hero)}",
        intro,
        _section("Recent matches", matches),
        footer,
        crumbs=[
            ("Home", "/"),
            ("Players", "/players"),
            (persona, f"/player/{account_id}"),
            (hero, f"/player/{account_id}/hero/{hero_id}"),
        ],
    )


def _hero_page(hero_id: int) -> str:
    hero = get_hero_name(hero_id)
    if not hero or hero.startswith("Hero "):
        return ""

    totals = _rows(
        "SELECT COUNT(*) games, SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players WHERE hero_id = ?",
        (hero_id,),
    )
    games = _int(totals[0].get("games")) if totals else 0
    if not games:
        return _article(
            "hero",
            _esc(hero),
            f"{_esc(hero)} has no Night Shift games on record.",
            "",
            f"<p>{_link('/heroes', 'All heroes')}</p>",
            crumbs=[("Home", "/"), ("Heroes", "/heroes"), (hero, f"/hero/{hero_id}")],
        )
    wins = _int(totals[0].get("wins")) or 0
    all_appearances = _rows("SELECT COUNT(*) total FROM players")
    total = _int(all_appearances[0].get("total")) if all_appearances else 0
    intro = (
        f"Deadlock hero statistics for {_esc(hero)}: {_count(games, 'game')}, "
        f"{_count(wins, 'win')} ({_fmt_pct(wins, games)}), "
        f"{_fmt_pct(games, total)} of all player appearances."
    )

    top_players = _rows(
        "SELECT p.account_id, u.persona_name, COUNT(*) games, "
        "SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players p LEFT JOIN users u ON u.account_id = p.account_id "
        "WHERE p.hero_id = ? GROUP BY p.account_id, u.persona_name "
        "ORDER BY games DESC LIMIT 8",
        (hero_id,),
    )
    table = _table(
        ["Player", "Games", "Wins", "Win rate"],
        [
            [
                _link(f"/player/{row['account_id']}", row.get("persona_name") or f"Player {row['account_id']}"),
                _esc(_fmt_int(row.get("games"))),
                _esc(_fmt_int(row.get("wins"))),
                _esc(_fmt_pct(row.get("wins"), row.get("games"))),
            ]
            for row in top_players
        ],
    )
    footer = (
        f"<p>{_link('/heroes', 'All heroes')} · {_link('/players', 'Player leaderboards')}</p>"
    )
    return _article(
        "hero",
        _esc(hero),
        intro,
        _section("Top players", table),
        footer,
        crumbs=[("Home", "/"), ("Heroes", "/heroes"), (hero, f"/hero/{hero_id}")],
    )


def _team_page(team_name: str) -> str:
    name = team_name.strip()
    if not name:
        return ""

    matches = _rows(
        "SELECT match_id, event_title, event_week, event_team_a, event_team_b, "
        "event_game, event_team_a_ingame_side, winning_team, start_time, created_at "
        "FROM matches WHERE LOWER(event_team_a) = LOWER(?) OR LOWER(event_team_b) = LOWER(?) "
        "ORDER BY match_id DESC LIMIT 500",
        (name, name),
    )
    if not matches:
        return _article(
            "team",
            _esc(name),
            f"No Night Shift matches found for {_esc(name)}.",
            "",
            f"<p>{_link('/teams', 'All teams')}</p>",
            crumbs=[("Home", "/"), ("Teams", "/teams"), (name, _team_href(name))],
        )

    canonical_name = name
    for match in matches:
        for candidate in (match.get("event_team_a"), match.get("event_team_b")):
            if candidate and str(candidate).lower() == name.lower():
                canonical_name = str(candidate)
                break
        if canonical_name != name:
            break
    wins = losses = 0
    for match in matches:
        winner = _winner_name(match)
        if not winner:
            continue
        if winner.lower() == canonical_name.lower():
            wins += 1
        else:
            losses += 1
    played = wins + losses

    intro = (
        f"Deadlock Night Shift team profile: {_count(played, 'game')}, "
        f"{_count(wins, 'win')} and {_count(losses, 'loss', 'losses')} "
        f"({_fmt_pct(wins, played)} win rate)."
    )

    roster = _rows(
        "SELECT p.account_id, u.persona_name, COUNT(*) games "
        "FROM players p JOIN matches m ON m.match_id = p.match_id "
        "LEFT JOIN users u ON u.account_id = p.account_id "
        "WHERE (LOWER(m.event_team_a) = LOWER(?) "
        "       AND p.team = COALESCE(m.event_team_a_ingame_side, 0)) "
        "   OR (LOWER(m.event_team_b) = LOWER(?) "
        "       AND p.team = 1 - COALESCE(m.event_team_a_ingame_side, 0)) "
        "GROUP BY p.account_id, u.persona_name ORDER BY games DESC LIMIT 10",
        (name, name),
    )
    roster_table = _table(
        ["Player", "Games"],
        [
            [
                _link(f"/player/{row['account_id']}", row.get("persona_name") or f"Player {row['account_id']}"),
                _esc(_fmt_int(row.get("games"))),
            ]
            for row in roster
        ],
    )

    recent = _recent_matches_table(matches[:_TABLE_LIMIT], team_name=canonical_name)
    body = _section("Roster", roster_table) + _section("Recent matches", recent)
    footer = (
        f"<p>{_link('/teams', 'All teams')} · {_link('/week', 'Night Shift weeks')}</p>"
    )
    return _article(
        "team",
        _esc(canonical_name),
        intro,
        body,
        footer,
        crumbs=[("Home", "/"), ("Teams", "/teams"), (canonical_name, _team_href(canonical_name))],
    )


def _week_page(week: int) -> str:
    event_title = (request.args.get("event_title") or "Night Shift").strip()
    params: list[Any] = [week]
    sql = (
        "SELECT match_id, event_team_a, event_team_b, event_game, "
        "event_team_a_ingame_side, winning_team, start_time, created_at "
        "FROM matches WHERE event_week = ?"
    )
    if event_title:
        sql += " AND event_title = ?"
        params.append(event_title)
    sql += " ORDER BY match_id ASC LIMIT 100"
    matches = _rows(sql, tuple(params))

    title = f"Night Shift Week {week}"
    if not matches:
        return _article(
            "week",
            _esc(title),
            "No matches are recorded for this week.",
            "",
            f"<p>{_link('/week', 'All weeks')}</p>",
            crumbs=[("Home", "/"), ("Night Shift weeks", "/week"), (f"Week {week}", f"/week/{week}")],
        )

    rows = []
    for match in matches:
        teams = _side_teams(match)
        matchup = " vs ".join(part for part in (teams.get(0), teams.get(1)) if part)
        rows.append(
            [
                _link(f"/matches/{match['match_id']}", matchup or f"Match {match['match_id']}"),
                _esc(match.get("event_game") or "—"),
                _esc(_winner_name(match) or "—"),
                _esc(_fmt_date(match.get("start_time") or match.get("created_at"))),
                _link(f"/series/{match['match_id']}", "Series"),
            ]
        )
    table = _table(["Match", "Game", "Winner", "Date", "Series"], rows)
    teams = sorted(
        {
            str(name)
            for match in matches
            for name in (match.get("event_team_a"), match.get("event_team_b"))
            if name
        }
    )
    team_links = " · ".join(_link(_team_href(name), name) for name in teams)
    footer = f"<p>{_link('/week', 'All weeks')} · {team_links}</p>" if team_links else f"<p>{_link('/week', 'All weeks')}</p>"
    intro = f"Results, series and hero picks for {_count(len(matches), 'game')} in Night Shift Week {week}."
    return _article(
        "week",
        _esc(title),
        intro,
        _section("Matches", table),
        footer,
        crumbs=[("Home", "/"), ("Night Shift weeks", "/week"), (f"Week {week}", f"/week/{week}")],
    )


def _recent_matches_page(home: bool = False) -> str:
    matches = _rows(
        "SELECT match_id, event_title, event_week, event_team_a, event_team_b, "
        "event_game, event_team_a_ingame_side, winning_team, start_time, created_at "
        "FROM matches ORDER BY match_id DESC LIMIT 20"
    )
    if not matches:
        return ""
    intro = (
        "Latest Deadlock Night Shift and Fight Night match results, with full "
        "scoreboards, player statistics and series links."
    )
    footer = (
        f"<p>{_link('/players', 'Players')} · {_link('/teams', 'Teams')} · "
        f"{_link('/heroes', 'Heroes')} · {_link('/stats/', 'League stats')} · "
        f"{_link('/week', 'Weekly results')}</p>"
    )
    return _article(
        "matchlist",
        "Deadlock Night Shift match results",
        intro,
        _section("Latest matches", _recent_matches_table(matches)),
        footer,
        crumbs=None if home else [("Home", "/"), ("Match results", "/matchlist")],
    )


def _players_page() -> str:
    rows = _rows(
        "SELECT p.account_id, u.persona_name, COUNT(*) games, "
        "SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players p LEFT JOIN users u ON u.account_id = p.account_id "
        "GROUP BY p.account_id, u.persona_name ORDER BY games DESC LIMIT 25"
    )
    if not rows:
        return ""
    table = _table(
        ["Player", "Games", "Wins", "Win rate"],
        [
            [
                _link(f"/player/{row['account_id']}", row.get("persona_name") or f"Player {row['account_id']}"),
                _esc(_fmt_int(row.get("games"))),
                _esc(_fmt_int(row.get("wins"))),
                _esc(_fmt_pct(row.get("wins"), row.get("games"))),
            ]
            for row in rows
        ],
    )
    return _article(
        "players",
        "Deadlock Night Shift player leaderboard",
        "Player win rates, game counts and profiles for the DLNS Night Shift league.",
        _section("Players", table),
        f"<p>{_link('/teams', 'Teams')} · {_link('/heroes', 'Heroes')}</p>",
        crumbs=[("Home", "/"), ("Players", "/players")],
    )


def _teams_page() -> str:
    rows = _rows(
        "SELECT team_name, COUNT(*) games FROM ("
        "SELECT event_team_a AS team_name FROM matches WHERE event_team_a IS NOT NULL AND event_team_a <> '' "
        "UNION ALL "
        "SELECT event_team_b AS team_name FROM matches WHERE event_team_b IS NOT NULL AND event_team_b <> ''"
        ") GROUP BY team_name ORDER BY games DESC LIMIT 60"
    )
    if not rows:
        return ""
    table = _table(
        ["Team", "Games"],
        [
            [_link(_team_href(str(row["team_name"])), row["team_name"]), _esc(_fmt_int(row.get("games")))]
            for row in rows
        ],
    )
    return _article(
        "teams",
        "Deadlock Night Shift teams",
        "Team records, rosters and weekly results across the DLNS Night Shift league.",
        _section("Teams", table),
        f"<p>{_link('/players', 'Players')} · {_link('/week', 'Weekly results')}</p>",
        crumbs=[("Home", "/"), ("Teams", "/teams")],
    )


def _heroes_page() -> str:
    rows = _rows(
        "SELECT hero_id, COUNT(*) games, SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) wins "
        "FROM players GROUP BY hero_id ORDER BY games DESC"
    )
    if not rows:
        return ""
    table = _table(
        ["Hero", "Games", "Wins", "Win rate"],
        [
            [
                _link(f"/hero/{row['hero_id']}", get_hero_name(_int(row.get("hero_id")))),
                _esc(_fmt_int(row.get("games"))),
                _esc(_fmt_int(row.get("wins"))),
                _esc(_fmt_pct(row.get("wins"), row.get("games"))),
            ]
            for row in rows
        ],
    )
    return _article(
        "heroes",
        "Deadlock hero statistics",
        "Pick rates, win rates and top players for every Deadlock hero in the Night Shift league.",
        _section("Heroes", table),
        f"<p>{_link('/players', 'Players')} · {_link('/teams', 'Teams')}</p>",
        crumbs=[("Home", "/"), ("Heroes", "/heroes")],
    )


def _plain_markdown(text: str, limit: int = 900) -> str:
    """Strip markup for a safe text excerpt.

    The interview body is rendered client-side with raw HTML; putting that markup
    straight into the server response would widen the XSS surface. A plain-text
    excerpt gives crawlers the subject matter without trusting the markdown.
    """
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text or "")
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[#*_>`~]+", " ", text)
    return " ".join(text.split())[:limit]


def _interview_index_page() -> str:
    from .blueprints.interviews import _load_entries

    entries = _load_entries()
    if not entries:
        return ""
    sorted_entries = sorted(
        entries, key=lambda entry: str(entry.get("created_at") or ""), reverse=True
    )[:_TABLE_LIMIT * 2]
    rows = []
    for entry in sorted_entries:
        title = entry.get("title") or "Interview"
        token = entry.get("short_id") or entry.get("id")
        rows.append(
            [
                _link(f"/interviews/{token}", title),
                _esc(entry.get("guest") or "—"),
                _esc(_fmt_date(entry.get("created_at"))),
            ]
        )
    return _article(
        "interviews",
        "Deadlock Night Shift interviews",
        "Conversations with Deadlock Night Shift players, teams and community figures.",
        _section("Interviews", _table(["Title", "Guest", "Published"], rows)),
        f"<p>{_link('/players', 'Players')} · {_link('/week', 'Weekly results')}</p>",
        crumbs=[("Home", "/"), ("Interviews", "/interviews/")],
    )


def _interview_detail_page(entry_ref: str) -> str:
    from .blueprints.interviews import _read_entry_markdown, _resolve_entry_ref

    entry, _source = _resolve_entry_ref(unquote(entry_ref))
    if not entry or not entry.get("title"):
        return ""
    title = str(entry["title"]).strip()
    guest = str(entry.get("guest") or "").strip()
    excerpt = _plain_markdown(_read_entry_markdown(entry))
    intro_bits = []
    if guest:
        intro_bits.append(f"Guest: {guest}")
    if entry.get("created_at"):
        intro_bits.append(_fmt_date(entry.get("created_at")))
    intro = " · ".join(_esc(bit) for bit in intro_bits) or "Deadlock Night Shift interview."
    body = f"<p>{_esc(excerpt)}</p>" if excerpt else ""
    token = entry.get("short_id") or entry.get("id")
    return _article(
        "interview",
        _esc(title),
        intro,
        body,
        f"<p>{_link('/interviews/', 'All interviews')} · {_link('/players', 'Players')}</p>",
        crumbs=[("Home", "/"), ("Interviews", "/interviews/"), (title, f"/interviews/{token}")],
    )


def _week_index_page() -> str:
    rows = _rows(
        "SELECT event_week, COUNT(*) games FROM matches "
        "WHERE event_week IS NOT NULL AND event_title = ? "
        "GROUP BY event_week ORDER BY event_week DESC LIMIT 20",
        ("Night Shift",),
    )
    if not rows:
        return ""
    table = _table(
        ["Week", "Games"],
        [
            [
                _link(f"/week/{row['event_week']}", f"Night Shift Week {row['event_week']}"),
                _esc(_fmt_int(row.get("games"))),
            ]
            for row in rows
        ],
    )
    return _article(
        "weeks",
        "Night Shift weekly results",
        "Browse weekly brackets, series results, standings and hero picks.",
        _section("Weeks", table),
        f"<p>{_link('/', 'Latest matches')} · {_link('/teams', 'Teams')}</p>",
        crumbs=[("Home", "/"), ("Night Shift weeks", "/week")],
    )


def _build(path: str) -> str:
    match = _MATCH_RE.match(path)
    if match:
        return _match_page(int(match.group(1)))

    player_hero = _PLAYER_HERO_RE.match(path)
    if player_hero:
        return _player_hero_page(int(player_hero.group(1)), int(player_hero.group(2)))

    player = _PLAYER_RE.match(path)
    if player:
        return _player_page(int(player.group(1)))

    hero = _HERO_RE.match(path)
    if hero:
        return _hero_page(int(hero.group(1)))

    team = _TEAM_RE.match(path)
    if team:
        return _team_page(unquote(team.group(1)))

    week = _WEEK_RE.match(path)
    if week:
        return _week_page(int(week.group(1)))

    interview = _INTERVIEW_RE.match(path)
    if interview:
        return _interview_detail_page(interview.group(1))

    if path == "/interviews/":
        return _interview_index_page()
    if path == "/":
        return _recent_matches_page(home=True)
    if path == "/matchlist":
        return _recent_matches_page()
    if path == "/players":
        return _players_page()
    if path == "/teams":
        return _teams_page()
    if path == "/heroes":
        return _heroes_page()
    if path == "/week":
        return _week_index_page()
    return ""


def _cache_key(path: str) -> str:
    db_path = str(current_app.config.get("DB_PATH", ""))
    event_title = (request.args.get("event_title") or "").strip() if has_request_context() else ""
    return f"{db_path}|{path}|{event_title}"


def _cached(key: str, loader) -> str:
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]
    value = loader()
    if len(_cache) >= _MAX_CACHE_ENTRIES:
        for stale in list(_cache)[: _MAX_CACHE_ENTRIES // 2]:
            _cache.pop(stale, None)
    _cache[key] = (now, value)
    return value


def build_prerender_html() -> str:
    if not has_request_context() or not _enabled():
        return ""
    try:
        path = _canonical_path(request.path or "/")
        return _cached(_cache_key(path), lambda: _build(path))
    except Exception:
        # A crawlable snapshot is an enhancement; it must never break a page.
        return ""


def register_prerender(app: Flask) -> None:
    @app.context_processor
    def _inject_prerender():
        return {"prerender_html": build_prerender_html()}
