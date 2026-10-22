import tempfile
import unittest
from pathlib import Path

from flask import Flask

from backend.app.main_web import _configure_file_logging


class FileLoggingTests(unittest.TestCase):
    def test_logs_are_split_into_rotating_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = Path(tmpdir) / "logs"
            app = Flask(__name__)
            _configure_file_logging(app, log_dir)

            app.logger.info("application event")
            app.logger.warning("SLOW GET /example 404 5000ms cache=-")
            app.logger.error("application failure")
            for handler in app.logger.handlers:
                handler.flush()

            app_log = (log_dir / "app.log").read_text(encoding="utf-8")
            errors_log = (log_dir / "errors.log").read_text(encoding="utf-8")
            slow_log = (log_dir / "slow_requests.log").read_text(encoding="utf-8")

        self.assertIn("application event", app_log)
        self.assertIn("application failure", app_log)
        self.assertNotIn("application event", errors_log)
        self.assertIn("application failure", errors_log)
        self.assertIn("SLOW GET /example", slow_log)
        self.assertNotIn("application failure", slow_log)


if __name__ == "__main__":
    unittest.main()
