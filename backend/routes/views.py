from flask import Blueprint, render_template

# Definimos el blueprint para las rutas de visualización
views_bp = Blueprint('views', __name__)

@views_bp.route("/", methods=["GET"])
def inicio():
    # Renderiza frontend/src/index.html (Verificador de Precios)
    return render_template("index.html")

@views_bp.route("/turnos", methods=["GET"])
def pantalla_turnos():
    # Renderiza frontend/src/turnos.html (Pantalla Multi-Zona 70% Publicidad / 30% Turnos RapidCola)
    return render_template("turnos.html")