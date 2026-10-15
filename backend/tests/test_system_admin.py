import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.blueprints import admin


class SystemAdminTests(unittest.TestCase):
    def test_git_info_includes_authors_and_recent_history(self):
        git_responses = {
            ('log', '-1', '--format=%H%x1f%cI%x1f%an%x1f%s'):
                'localsha\x1f2026-10-15T10:00:00+00:00\x1fLocal Author\x1fRunning commit',
            ('log', '-8', '--format=%H%x1f%cI%x1f%an%x1f%s'): (
                'localsha\x1f2026-10-15T10:00:00+00:00\x1fLocal Author\x1fRunning commit\n'
                'oldsha\x1f2026-10-14T10:00:00+00:00\x1fOther Author\x1fPrevious commit'
            ),
            ('ls-remote', 'origin', 'refs/heads/main'): 'remotesha\trefs/heads/main',
            ('log', '-1', '--format=%cI%x1f%an%x1f%s', 'remotesha'):
                '2026-10-15T10:00:00+00:00\x1fRemote Author\x1fRemote commit',
        }

        def fake_git(*args):
            return git_responses[args]

        with patch.dict(admin._GIT_CACHE, {'at': 0, 'data': None}), \
                patch.object(admin, '_git', side_effect=fake_git), \
                patch.object(admin, '_github_base_url', return_value='https://github.com/example/site'), \
                patch.dict('os.environ', {'UPDATE_BRANCH': 'main'}):
            result = admin._git_info()

        self.assertEqual(result['local']['author'], 'Local Author')
        self.assertEqual(result['remote']['author'], 'Remote Author')
        self.assertEqual([commit['author'] for commit in result['history']], ['Local Author', 'Other Author'])
        self.assertEqual(result['history'][0]['url'], 'https://github.com/example/site/commit/localsha')
        self.assertEqual(result['repository_url'], 'https://github.com/example/site')

    def test_system_file_sizes_reports_missing_files_as_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            file_path = Path(tmp) / 'backend' / 'main.py'
            file_path.parent.mkdir()
            file_path.write_bytes(b'12345')

            sizes = admin._system_file_sizes(Path(tmp))

        self.assertEqual(sizes[0], {'path': 'backend/main.py', 'size_bytes': 5})
        self.assertTrue(all(item['size_bytes'] is None for item in sizes[1:]))


if __name__ == '__main__':
    unittest.main()
