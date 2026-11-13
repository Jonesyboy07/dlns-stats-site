import os
import logging
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.cdn_logging import configure_cdn_logging
from backend.cdn import create_cdn_app
from scripts import sync_cdn_assets


def close_managed_handlers(logger):
    for handler in list(logger.handlers):
        if getattr(handler, '_cdn_file_handler', False):
            logger.removeHandler(handler)
            handler.close()


class CdnLoggingTests(unittest.TestCase):
    def test_log_rotation_and_handler_reconfiguration(self):
        logger = logging.getLogger('test.cdn.rotation')
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            try:
                with patch.dict(os.environ, {'LOG_DIR': first}):
                    configure_cdn_logging(logger, 'cdn.log')
                    handler = next(h for h in logger.handlers if getattr(h, '_cdn_file_handler', False))
                    self.assertEqual(handler.maxBytes, 5 * 1024 * 1024)
                    self.assertEqual(handler.backupCount, 5)
                    handler.maxBytes = 100
                    logger.info('a' * 80)
                    logger.info('b' * 80)
                    self.assertTrue((Path(first) / 'cdn.log.1').is_file())
                with patch.dict(os.environ, {'LOG_DIR': second}):
                    configure_cdn_logging(logger, 'cdn.log')
                    logger.info('new location')
                    self.assertEqual(sum(bool(getattr(h, '_cdn_file_handler', False))
                                         for h in logger.handlers), 1)
                    self.assertIn('new location', (Path(second) / 'cdn.log').read_text(encoding='utf-8'))
            finally:
                close_managed_handlers(logger)

    def test_origin_records_requests_errors_and_reuses_handler(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'cdn'
            root.mkdir()
            (root / 'example.css').write_text('body{}')
            log_dir = Path(tmp) / 'logs'
            with patch.dict(os.environ, {'LOG_DIR': str(log_dir)}):
                app = create_cdn_app(root)
                try:
                    configure_cdn_logging(app.logger, 'cdn.log')
                    self.assertEqual(sum(bool(getattr(h, '_cdn_file_handler', False))
                                         for h in app.logger.handlers), 1)
                    client = app.test_client()
                    response = client.get('/example.css?secret=not-logged')
                    self.assertEqual(response.status_code, 200)
                    response.close()
                    self.assertEqual(client.get('/missing.css').status_code, 404)
                    self.assertEqual(client.get('/__cdn/site-assets').status_code, 503)
                    log = (log_dir / 'cdn.log').read_text(encoding='utf-8')
                    self.assertIn('CDN origin started', log)
                    self.assertIn('path=/example.css status=200', log)
                    self.assertIn('path=/missing.css status=404', log)
                    self.assertIn('path=/__cdn/site-assets status=503', log)
                    self.assertNotIn('not-logged', log)
                    self.assertEqual(log.count('path=/example.css status=200'), 1)
                finally:
                    close_managed_handlers(app.logger)

    def test_sync_logs_publication_and_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'cdn'
            source = Path(tmp) / 'site'
            log_dir = Path(tmp) / 'logs'
            root.mkdir()
            (source / 'public' / 'css').mkdir(parents=True)
            (source / 'public' / 'css' / 'styles.css').write_text('body{}')
            with patch.dict(os.environ, {'LOG_DIR': str(log_dir), 'CDN_ROOT': str(root)}), \
                    patch.object(sync_cdn_assets, 'PROJECT', source), \
                    patch.object(sys, 'argv', ['sync_cdn_assets']):
                try:
                    sync_cdn_assets.main()
                    with patch.object(sync_cdn_assets, 'sync', side_effect=RuntimeError('test failure')):
                        with self.assertRaises(RuntimeError):
                            sync_cdn_assets.main()
                    log = (log_dir / 'cdn_sync.log').read_text(encoding='utf-8')
                    self.assertIn('CDN asset sync started', log)
                    self.assertIn('Published __site_assets/css/styles.', log)
                    self.assertIn('Updated site asset manifest; assets=1', log)
                    self.assertIn('CDN asset sync completed', log)
                    self.assertIn('CDN asset sync failed', log)
                    self.assertIn('RuntimeError: test failure', log)
                finally:
                    close_managed_handlers(sync_cdn_assets.logger)

    def test_origin_startup_failure_is_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {'LOG_DIR': tmp, 'CDN_ROOT': ''}):
                try:
                    with self.assertRaises(RuntimeError):
                        create_cdn_app()
                    log = (Path(tmp) / 'cdn.log').read_text(encoding='utf-8')
                    self.assertIn('CDN startup failed', log)
                    self.assertIn('CDN_ROOT is not configured', log)
                finally:
                    close_managed_handlers(logging.getLogger('backend.cdn'))


if __name__ == '__main__':
    unittest.main()
