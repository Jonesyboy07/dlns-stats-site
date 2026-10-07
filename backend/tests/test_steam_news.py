"""Tests for choosing the Steam announcements a Night Shift week should link to.

`news_for_week` is pure over a post list and the week's game windows, so both
halves of the rule can be exercised without a network call: the game update is
kept however old it is, while a hero reveal is dropped once it goes stale.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import steam_news
from backend.steam_news import (
    HERO_MAX_AGE_S,
    KIND_HERO,
    KIND_UPDATE,
    SteamNewsStore,
    news_for_week,
    post_kind,
    resolve_store_url,
)


def game(start, minutes):
    """A game as (start epoch, end epoch)."""
    return (start, start + minutes * 60)


# 2026-07-01 20:42 UTC, the first game of Night Shift week 45.
BASE = 1782938520


def post(ts, title="Minor Update - 07-01-2026"):
    return {"ts": ts, "title": title, "kind": post_kind(title), "url": "https://example.invalid"}


def update(ts, title="Minor Update - 07-01-2026"):
    return post(ts, title)


def hero(ts, title="The Curse Beckons for Silver"):
    return post(ts, title)


class NewsForWeekTests(unittest.TestCase):
    def test_picks_the_newest_update_before_the_week(self):
        # Week 48's shape: played 2026-07-14, newest update is the 09th.
        games = [game(BASE, 31), game(BASE + 518400, 33)]
        chosen = news_for_week(
            [update(BASE - 432000, "Minor Update - 07-09-2026"), update(BASE - 1728000, "Minor Update - 06-04-2026")],
            games,
        )
        self.assertEqual(chosen["update"]["title"], "Minor Update - 07-09-2026")
        self.assertFalse(chosen["update"]["during_games"])

    def test_a_hero_reveal_does_not_displace_the_update(self):
        games = [game(BASE, 30)]
        chosen = news_for_week(
            [hero(BASE - 86400, "Mind the Birds!"), update(BASE - 1209600, "Minor Update - 07-09-2026")],
            games,
        )
        self.assertEqual(chosen["update"]["title"], "Minor Update - 07-09-2026")
        self.assertEqual(chosen["hero"]["title"], "Mind the Birds!")

    def test_drops_a_hero_reveal_older_than_four_weeks(self):
        games = [game(BASE, 30)]
        self.assertIsNone(news_for_week([hero(BASE - HERO_MAX_AGE_S - 1)], games)["hero"])

    def test_keeps_a_hero_reveal_at_the_four_week_edge(self):
        games = [game(BASE, 30)]  # the sitting finishes 30 minutes later
        chosen = news_for_week([hero(BASE + 1800 - HERO_MAX_AGE_S)], games)
        self.assertIsNotNone(chosen["hero"])

    def test_an_old_update_is_kept_however_stale_it_is(self):
        # Weeks 9-15 sit months after the last update; that is still the context.
        games = [game(BASE, 30)]
        chosen = news_for_week([update(BASE - 200 * 86400, "Shop Rework Update")], games)
        self.assertEqual(chosen["update"]["title"], "Shop Rework Update")

    def test_flags_an_update_that_landed_during_a_game(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 6960, 33)]
        posted = BASE + 7920  # inside the third game
        chosen = news_for_week([update(posted)], games)
        self.assertEqual(chosen["update"]["ts"], posted)
        self.assertTrue(chosen["update"]["during_games"])

    def test_flags_an_update_that_landed_between_two_games_of_one_sitting(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 10500, 38)]
        chosen = news_for_week([update(BASE + 4800)], games)
        self.assertTrue(chosen["update"]["during_games"])

    def test_does_not_flag_an_update_published_between_two_different_nights(self):
        # Week 49's shape: a short night, then a longer one the next day, with the
        # patch posted in the long gap between them.
        games = [
            game(BASE, 41),
            game(BASE + 3360, 26),
            game(BASE + 94380, 33),
            game(BASE + 97980, 27),
            game(BASE + 101580, 32),
        ]
        posted = BASE + 7640  # 40 minutes after the first night's games ended
        chosen = news_for_week([update(posted)], games)
        self.assertEqual(chosen["update"]["ts"], posted)
        self.assertFalse(chosen["update"]["during_games"])

    def test_ignores_an_update_published_after_the_week(self):
        games = [game(BASE, 30)]
        chosen = news_for_week([update(BASE + 86400, "Minor Update - 07-02-2026")], games)
        self.assertIsNone(chosen["update"])
        self.assertIsNone(chosen["hero"])

    def test_ignores_a_stray_game_months_after_the_week(self):
        # Weeks 22 and 40 carry a synthetic placeholder row stamped months later;
        # the busiest sitting is the real broadcast, so it must not set the cutoff.
        real = [game(BASE + i * 3600, 30) for i in range(5)]
        stray = game(BASE + 90 * 86400, 1)
        chosen = news_for_week([update(BASE + 80 * 86400)], real + [stray])
        self.assertIsNone(chosen["update"])

    def test_both_are_none_without_games_or_posts(self):
        self.assertEqual(news_for_week([update(BASE)], []), {"update": None, "hero": None})
        self.assertEqual(news_for_week([], [game(BASE, 30)]), {"update": None, "hero": None})

    def test_ignores_a_post_without_a_timestamp(self):
        chosen = news_for_week([{"title": "Broken", "kind": KIND_UPDATE}], [game(BASE, 30)])
        self.assertIsNone(chosen["update"])

    def test_an_unclassified_post_counts_as_an_update(self):
        # Entries cached before posts carried a kind must not vanish.
        games = [game(BASE, 30)]
        chosen = news_for_week([{"ts": BASE - 60, "title": "Untyped"}], games)
        self.assertEqual(chosen["update"]["title"], "Untyped")


class PostKindTests(unittest.TestCase):
    def test_patch_notes_and_reworks_are_updates(self):
        for title in (
            "Minor Update - 10-05-2026",
            "Gameplay Update - 03-06-2026",
            "Map Rework Update",
            "Shop Rework Update",
            "Winter Visual Update",
            "Hotfix 12",
        ):
            self.assertEqual(post_kind(title), KIND_UPDATE, title)

    def test_a_season_launch_without_an_update_word_is_an_update(self):
        # Curated, because these are major updates whose titles say nothing of
        # the sort — the hero reveals that follow them are not the update.
        self.assertEqual(post_kind("City Never Sleeps"), KIND_UPDATE)
        self.assertEqual(post_kind("Old Gods, New Blood"), KIND_UPDATE)
        self.assertEqual(post_kind("Six New Heroes"), KIND_UPDATE)

    def test_hero_reveals_are_heroes(self):
        for title in (
            "Mind the Birds!",
            "The Curse Beckons for Silver",
            "Introducing The Dazzling Celeste",
            "Rem Enters The City That Never Sleeps",
            "Listen up, Crumbums! Your King is here.",
        ):
            self.assertEqual(post_kind(title), KIND_HERO, title)


class StoreUrlTests(unittest.TestCase):
    def test_returns_none_when_the_url_is_unusable(self):
        # No network in tests: an unreachable host must degrade to no link.
        self.assertIsNone(resolve_store_url(""))


class LazyLinkTests(unittest.TestCase):
    """The store URL is worked out when a week shows a post, not for the whole list.

    Resolving every announcement up front cost a request each on a cold cache,
    which the first week page of a deploy had to wait for.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = SteamNewsStore(cache_dir=Path(self.tmp.name))
        payload = {
            "appnews": {
                "newsitems": [
                    {
                        "feedname": "steam_community_announcements",
                        "gid": "1",
                        "title": "Minor Update - 07-01-2026",
                        "date": BASE,
                        "url": "https://example.invalid/1",
                    },
                    {
                        "feedname": "steam_community_announcements",
                        "gid": "2",
                        "title": "Mind the Birds!",
                        "date": BASE - 86400,
                        "url": "https://example.invalid/2",
                    },
                    {
                        # An older update still in the feed: the week shows the
                        # newest one, so nothing should ask Steam about this.
                        "feedname": "steam_community_announcements",
                        "gid": "3",
                        "title": "Winter Visual Update",
                        "date": BASE - (100 * 86400),
                        "url": "https://example.invalid/3",
                    },
                ]
            }
        }
        self.fetch = mock.patch.object(steam_news, "_fetch", return_value=json.dumps(payload))
        self.fetch.start()
        self.addCleanup(self.fetch.stop)
        self.resolve = mock.patch.object(
            steam_news, "resolve_store_url", return_value="https://store.invalid/1"
        )
        self.resolver = self.resolve.start()
        self.addCleanup(self.resolve.stop)
        self.games = [game(BASE + 600, 31)]

    def resolved_links(self):
        return sorted(call.args[0] for call in self.resolver.call_args_list)

    def test_syncing_resolves_nothing(self):
        self.assertTrue(self.store.sync())
        self.assertEqual(self.resolver.call_count, 0)

    def test_resolves_only_the_posts_a_week_shows(self):
        self.store.sync()
        chosen = self.store.news_for_week(self.games)
        # The week shows its newest update and the hero reveal that is still recent.
        self.assertEqual(chosen["update"]["url"], "https://store.invalid/1")
        self.assertEqual(chosen["hero"]["title"], "Mind the Birds!")
        self.assertEqual(
            self.resolved_links(),
            ["https://example.invalid/1", "https://example.invalid/2"],
        )

    def test_a_resolved_link_is_reused(self):
        self.store.sync()
        self.store.news_for_week(self.games)
        self.store.news_for_week(self.games)
        self.assertEqual(self.resolver.call_count, 2)

    def test_a_failed_resolution_falls_back_and_is_not_retried(self):
        self.resolver.return_value = None
        self.store.sync()
        chosen = self.store.news_for_week(self.games)
        self.assertEqual(chosen["update"]["url"], "https://example.invalid/1")
        self.store.news_for_week(self.games)
        self.assertEqual(self.resolver.call_count, 2)


if __name__ == "__main__":
    unittest.main()
