"""Tests for picking the patch notes a Night Shift week should link to.

`notes_in_window` is pure over a note list and the week's game windows, so the
"did a patch land mid-broadcast?" rule can be exercised without a network call.
"""

import unittest

from backend.patch_notes import looks_like_patch_note, notes_in_window, resolve_store_url


def game(start, minutes):
    """A game as (start epoch, end epoch)."""
    return (start, start + minutes * 60)


# 2026-07-01 20:42 UTC, the first game of Night Shift week 45.
BASE = 1782938520


def note(ts, title="Minor Update"):
    return {"ts": ts, "title": title, "url": "https://example.invalid"}


class NotesInWindowTests(unittest.TestCase):
    def test_returns_a_note_posted_during_a_game(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 6960, 33)]
        posted = BASE + 7920  # inside the third game
        found = notes_in_window([note(posted)], games)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["during_games"])

    def test_returns_a_note_posted_between_two_games_of_one_sitting(self):
        games = [game(BASE, 25), game(BASE + 3540, 30), game(BASE + 10500, 38)]
        posted = BASE + 4800  # in the 14-minute gap after the second game
        found = notes_in_window([note(posted)], games)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["during_games"])

    def test_marks_a_note_posted_between_two_different_nights_as_not_mid_broadcast(self):
        # Week 49's shape: two games on the 28th, the rest the next day, with the
        # patch posted in the long gap between them.
        games = [game(BASE, 41), game(BASE + 3360, 26), game(BASE + 94380, 33)]
        posted = BASE + 7640  # 40 minutes after the night's games ended
        found = notes_in_window([note(posted)], games)
        self.assertEqual(len(found), 1)
        self.assertFalse(found[0]["during_games"])

    def test_ignores_notes_outside_the_week_entirely(self):
        games = [game(BASE, 30)]
        self.assertEqual(notes_in_window([note(BASE - 86400), note(BASE + 86400)], games), [])

    def test_returns_notes_in_posted_order(self):
        games = [game(BASE, 30)]
        first, second = note(BASE + 60, "First"), note(BASE + 120, "Second")
        self.assertEqual([n["title"] for n in notes_in_window([second, first], games)],
                         ["First", "Second"])

    def test_is_empty_without_games_or_notes(self):
        self.assertEqual(notes_in_window([note(BASE)], []), [])
        self.assertEqual(notes_in_window([], [game(BASE, 30)]), [])

    def test_ignores_a_note_without_a_timestamp(self):
        self.assertEqual(notes_in_window([{"title": "Broken"}], [game(BASE, 30)]), [])


class PatchNoteFilterTests(unittest.TestCase):
    def test_keeps_patch_notes(self):
        for title in ("Minor Update - 10-05-2026", "Map Rework Update", "Hotfix 12"):
            self.assertTrue(looks_like_patch_note(title), title)

    def test_drops_marketing_and_hero_posts(self):
        for title in ("Mind the Birds!", "City Never Sleeps", "Introducing The Dazzling Celeste"):
            self.assertFalse(looks_like_patch_note(title), title)


class StoreUrlTests(unittest.TestCase):
    def test_returns_none_when_the_url_is_unusable(self):
        # No network in tests: an unreachable host must degrade to no link.
        self.assertIsNone(resolve_store_url(""))


if __name__ == "__main__":
    unittest.main()
