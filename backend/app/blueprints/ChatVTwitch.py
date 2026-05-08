import logging
from flask import Blueprint, request, jsonify, render_template_string

from dotenv import load_dotenv
import os

load_dotenv()

# ---------------- Logger ----------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------- Blueprint ----------------
chat_bp = Blueprint("chat", __name__, url_prefix="/chat")

# Store just the latest message
latest_message = None

# Auth Key - Prevents randoms from interacting
AUTH_KEY = os.getenv("CHAT_PLAYS_DEADLOCK_KEY")# Add a key in here

# Inline HTML template
overlay_html = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Deadlock TTS Overlay - Chatbox</title>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        #chatbox {
            position: relative;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            font-size: 36px;
            font-weight: bold;
            text-shadow: 1px 1px 4px rgba(0,0,0,0.7);
            padding: 20px 30px;
            border-radius: 16px;
            max-width: 600px;
            min-width: 300px;
            min-height: 150px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            box-shadow: 0 0 20px rgba(0,0,0,0.6);
            opacity: 0;
            transform: translateY(20px);
            animation: fadeIn 0.5s forwards;
        }

        @keyframes fadeIn {
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div id="chatbox">
        <div id="message">Waiting for summary...</div>
    </div>

    <script>
        async function fetchMessage() {
            try {
                const res = await fetch('/chat/messages');
                const data = await res.json();
                const msgBox = document.getElementById('message');
                msgBox.textContent = data ? data : '';
            } catch (err) {
                console.error('Error fetching message:', err);
            }
        }

        setInterval(fetchMessage, 2000);
        fetchMessage();
    </script>
</body>
</html>
"""

# ---------------- Routes ----------------
@chat_bp.route("/")
def overlay():
    """Serve the OBS overlay HTML inline"""
    return render_template_string(overlay_html)


@chat_bp.route("/api/summary", methods=["POST"])
def receive_summary():
    """Receive summary and store only the latest"""
    global latest_message
    try:
        # Check for AuthKey header
        auth_header = request.headers.get("AuthKey")
        if auth_header != AUTH_KEY:
            logger.warning("Unauthorized attempt with AuthKey=%s", auth_header)
            return jsonify({"error": "Unauthorized"}), 401
        

        data = request.get_json()
        if not data or "summary" not in data:
            return jsonify({"error": "Missing 'summary' in request"}), 400

        latest_message = data["summary"]
        logger.info(f"Received summary: {latest_message}")
        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logger.error(f"Error receiving summary: {e}")
        return jsonify({"error": str(e)}), 500


@chat_bp.route("/messages")
def get_message():
    """Return only the latest chat message"""
    return jsonify(latest_message)
