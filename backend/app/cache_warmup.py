from __future__ import annotations

import threading
import time
from typing import Any


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _discover_seed_ids(app) -> dict[str, Any]:
    seed: dict[str, Any] = {
        "match_id": None,
        "account_id": None,
        "hero_id": None,
        "event_title": None,
        "event_week": None,
    }

    try:
        from .blueprints.db_api import get_ro_conn

        with app.app_context():
            with get_ro_conn() as conn:
                row = conn.execute(
                    """
                    SELECT match_id, event_title, event_week
                    FROM matches
                    WHERE match_id > 0
                    ORDER BY COALESCE(start_time, created_at) DESC
                    LIMIT 1
                    """
                ).fetchone()
                if row:
                    seed["match_id"] = row[0]
                    seed["event_title"] = row[1]
                    seed["event_week"] = row[2]

                row = conn.execute(
                    """
                    SELECT account_id
                    FROM players
                    WHERE account_id IS NOT NULL
                    ORDER BY match_id DESC
                    LIMIT 1
                    """
                ).fetchone()
                if row:
                    seed["account_id"] = row[0]

                row = conn.execute(
                    """
                    SELECT hero_id
                    FROM players
                    WHERE hero_id IS NOT NULL
                    ORDER BY match_id DESC
                    LIMIT 1
                    """
                ).fetchone()
                if row:
                    seed["hero_id"] = row[0]
    except Exception as exc:
        app.logger.warning("Cache warmup seed discovery failed: %s", exc)

    return seed


def _build_warmup_paths(app) -> list[str]:
    paths: list[str] = [
        "/db/weeks",
        "/db/matches/tree",
        "/db/heroes",
        "/db/players",
        "/db/teams",
        "/db/stats/overview",
        "/db/stats/weekly",
        "/db/stats/records",
        "/db/stats/averages",
        "/db/stats/hero-selection",
        "/db/matches/latest",
        "/db/matches/latest/paged?page=1&per_page=20",
    ]

    seed = _discover_seed_ids(app)
    match_id = seed.get("match_id")
    account_id = seed.get("account_id")
    hero_id = seed.get("hero_id")
    event_title = seed.get("event_title")
    event_week = seed.get("event_week")

    if event_title:
        paths.append(f"/db/weeks?event_title={event_title}")
        paths.append(f"/db/stats/overview?event_title={event_title}")
        paths.append(f"/db/stats/weekly?event_title={event_title}")

    if match_id:
        paths.extend(
            [
                f"/db/matches/{match_id}/adjacent",
                f"/db/matches/{match_id}/players",
                f"/db/matches/{match_id}/timeline",
                f"/db/matches/{match_id}/items",
                f"/db/matches/{match_id}/build",
                f"/db/series/{match_id}",
            ]
        )

    if account_id:
        paths.extend(
            [
                f"/db/users/{account_id}",
                f"/db/users/{account_id}/stats",
                f"/db/users/{account_id}/matches/paged?page=1&per_page=20",
            ]
        )
        if match_id:
            paths.append(f"/db/matches/{match_id}/users/{account_id}")

    if hero_id:
        paths.extend(
            [
                f"/db/heroes/{hero_id}/stats",
                f"/db/heroes/{hero_id}/top_items",
                f"/db/heroes/{hero_id}/matchups",
                f"/db/heroes/{hero_id}/top_players",
                f"/db/heroes/{hero_id}/meta",
            ]
        )

    if event_title and event_week is not None:
        paths.append(f"/db/nightshift/{event_week}?event_title={event_title}")

    # Preserve order while deduping.
    return list(dict.fromkeys(paths))


def run_cache_warmup(app) -> dict[str, Any]:
    started_at = time.time()
    success = 0
    failed = 0
    failures: list[dict[str, Any]] = []

    paths = _build_warmup_paths(app)

    with app.app_context():
        with app.test_client() as client:
            for path in paths:
                try:
                    response = client.get(path)
                    if response.status_code < 500:
                        success += 1
                    else:
                        failed += 1
                        failures.append({"path": path, "status": response.status_code})
                except Exception as exc:
                    failed += 1
                    failures.append({"path": path, "error": str(exc)})

    elapsed_ms = int((time.time() - started_at) * 1000)
    result = {
        "ran_at": int(time.time()),
        "elapsed_ms": elapsed_ms,
        "total": len(paths),
        "success": success,
        "failed": failed,
        "failures": failures[:10],
    }
    app.extensions["cache_warmup_last_run"] = result
    return result


def schedule_cache_warmup(app) -> None:
    if app.extensions.get("cache_warmup_started"):
        return

    app.extensions["cache_warmup_started"] = True

    if not _to_bool(app.config.get("CACHE_WARMUP_ON_STARTUP"), True):
        app.logger.info("Cache warmup disabled by CACHE_WARMUP_ON_STARTUP")
        return

    delay_s = float(app.config.get("CACHE_WARMUP_DELAY_SECONDS", 1.0) or 0)

    def _runner() -> None:
        if delay_s > 0:
            time.sleep(delay_s)
        result = run_cache_warmup(app)
        app.logger.info(
            "Cache warmup finished in %sms (%s/%s successful)",
            result["elapsed_ms"],
            result["success"],
            result["total"],
        )
        if result["failed"]:
            app.logger.warning("Cache warmup had %s failures", result["failed"])

    thread = threading.Thread(target=_runner, name="cache-warmup", daemon=True)
    thread.start()
