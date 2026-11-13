import os
import unittest
from unittest.mock import Mock, patch

from scripts import run_site


class CdnRunnerTests(unittest.TestCase):
    @patch('scripts.run_site.load_dotenv')
    @patch('scripts.run_site.os.chdir')
    @patch('scripts.run_site.subprocess.Popen')
    @patch('scripts.run_site.subprocess.run')
    def test_sync_failure_prevents_site_start(self, run, popen, _chdir, _dotenv):
        run.side_effect = run_site.subprocess.CalledProcessError(1, 'sync')
        with patch.dict(os.environ, {'CDN_PUBLIC_BASE_URL': 'https://cdn.example',
                                     'CDN_MANIFEST_BASE_URL': 'http://localhost:5051'}):
            with self.assertRaises(run_site.subprocess.CalledProcessError):
                run_site.main()
        popen.assert_not_called()

    @patch('scripts.run_site.load_dotenv')
    @patch('scripts.run_site.os.chdir')
    @patch('scripts.run_site.subprocess.Popen')
    @patch('scripts.run_site.subprocess.run')
    def test_watcher_failure_stops_website(self, run, popen, _chdir, _dotenv):
        watcher = Mock(pid=1)
        watcher.poll.side_effect = [1, 1]
        website = Mock(pid=2)
        website.poll.return_value = None
        popen.side_effect = [watcher, website]
        with patch.dict(os.environ, {'CDN_PUBLIC_BASE_URL': 'https://cdn.example',
                                     'CDN_MANIFEST_BASE_URL': 'http://localhost:5051'}):
            self.assertEqual(run_site.main(), 1)
        run.assert_called_once()
        website.terminate.assert_called_once()
        website.wait.assert_called_once()

    @patch('scripts.run_site.load_dotenv')
    @patch('scripts.run_site.os.chdir')
    @patch('scripts.run_site.subprocess.Popen')
    @patch('scripts.run_site.subprocess.run')
    def test_site_without_cdn_does_not_sync(self, run, popen, _chdir, _dotenv):
        website = Mock(pid=2)
        website.poll.return_value = 0
        popen.return_value = website
        with patch.dict(os.environ, {'CDN_PUBLIC_BASE_URL': '', 'CDN_MANIFEST_BASE_URL': ''}):
            self.assertEqual(run_site.main(), 0)
        run.assert_not_called()
        self.assertEqual(popen.call_count, 1)


if __name__ == '__main__':
    unittest.main()
