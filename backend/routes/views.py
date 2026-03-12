from flask import Blueprint, render_template

# Definimos el blueprint para las rutas de visualización
views_bp = Blueprint('views', __name__)

@views_bp.route("/", methods=["GET"])
def inicio():
    # Renderiza frontend/src/index.html
    return render_template("index.html")