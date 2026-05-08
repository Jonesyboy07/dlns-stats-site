# blueprints/vdata.py
from pathlib import Path
from flask import Blueprint, render_template

# Set up paths relative to project root
project_root = Path(__file__).parent.parent.parent

vdata_editor_bp = Blueprint(
    "vdata_editor",
    __name__,
    template_folder=str(project_root / "templates" / "vdata_editor"),
    static_folder=str(project_root / "public"),
    url_prefix="/vdata"
)

@vdata_editor_bp.route("/")
def editor_home():
    # Standalone HTML – no base.html
    return render_template("vdata_editor/editor.html")
