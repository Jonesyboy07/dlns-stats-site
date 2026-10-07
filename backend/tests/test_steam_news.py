"""Tests for choosing the Steam announcement a Night Shift week should link to.

`news_for_week` is pure over a post list and the week's game windows, so the
selection rule — newest post by the week's final game, flagged when it landed
mid-broadcast — can be exercised without a network call.
"""

import unittest

from backend.steam_news import news_for_week, resolve_store_url


def game(start, minutes):
    """A game as (start epoch, end epoch)."""
    return (start, start + minutes * 60)


# 2026-07-01 20:42 UTC, the first game of Night Shift week 45.
BASE = 1782938520


def post(ts, title="Minor Update"):
    return {"ts": ts, "title": title, "url": "https://example.invalid"}


class NewsForWeekTests(unittest.TestCase):
    def test_picks_the_newest_post_before_the_week(self):
        # Week 48's shape: played 2026-07-14, newest post is the 09th.
        games = [game(BASE, 31), game(BASE + 518400, 33)]
        newer, older = post(BASE - 432000, "07-09"), post(BASE - 1728000, "06-04")
        chosen = news_for_week([newer, older], games)
        self.assertEqual(chosen["title"], "07-09")
        self.assertFalse(chosen["during_games"])

    def test_picks_a_hero_release_over_an_older_patch_note(self):
        # City Never Sleeps is not a patch note, but it is what week 58 came after.
        games = [game(BASE, 30)]
        chosen = news_for_week(
            [post(BASE - 86400, "City Never Sleeps"), post(BASE - 1209600, "Minor Update - 09-16-2026")],
            games,
        )
        self.assertEqual(chosen["title"], "City Never Sleeps")

    def test_flags_a_post_that_landed_during_a_game(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 6960, 33)]
        posted = BASE + 7920  # inside the third game
        chosen = news_for_week([post(posted)], games)
        self.assertEqual(chosen["ts"], posted)
        self.assertTrue(chosen["during_games"])

    def test_flags_a_post_that_landed_between_two_games_of_one_sitting(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 10500, 38)]
        posted = BASE + 4800  # in the 14-minute gap after the second game
        chosen = news_for_week([post(posted)], games)
        self.assertTrue(chosen["during_games"])

    def test_does_not_flag_a_post_published_between_two_different_nights(self):
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
        chosen = news_for_week([post(posted)], games)
        self.assertEqual(chosen["ts"], posted)
        self.assertFalse(chosen["during_games"])

    def test_ignores_a_post_published_after_the_week(self):
        games = [game(BASE, 30)]
        self.assertIsNone(news_for_week([post(BASE + 86400, "later")], games))

    def test_ignores_a_stray_game_months_after_the_week(self):
        # Weeks 22 and 40 carry a synthetic placeholder row stamped months later;
        # the busiest sitting is the real broadcast, so it must not set the cutoff.
        real = [game(BASE + i * 3600, 30) for i in range(5)]
        stray = game(BASE + 90 * 86400, 1)
        chosen = news_for_week([post(BASE + 80 * 86400, "too late")], real + [stray])
        self.assertIsNone(chosen)

    def test_is_none_without_games_or_posts(self):
        self.assertIsNone(news_for_week([post(BASE)], []))
        self.assertIsNone(news_for_week([], [game(BASE, 30)]))

    def test_ignores_a_post_without_a_timestamp(self):
        self.assertIsNone(news_for_week([{"title": "Broken"}], [game(BASE, 30)]))


class StoreUrlTests(unittest.TestCase):
    def test_returns_none_when_the_url_is_unusable(self):
        # No network in tests: an unreachable host must degrade to no link.
        self.assertIsNone(resolve_store_url(""))


if __name__ == "__main__":
    unittest.main()
