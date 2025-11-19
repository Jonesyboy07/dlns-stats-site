# blueprints/vdata.py
from flask import Blueprint, render_template

vdata_editor_bp = Blueprint(
    "vdata_editor",
    __name__,
    template_folder="../templates/vdata_editor",
    static_folder="../static",
    url_prefix="/vdata"
)

@vdata_editor_bp.route("/")
def editor_home():
    # Standalone HTML – no base.html
    return render_template("vdata_editor/editor.html")
