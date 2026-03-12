from flask import Blueprint, jsonify, abort, request
from services.product_service import consultar_detalle_producto, tasa_del_dia
from services.search_service import SearchService

api_bp = Blueprint('api', __name__)

@api_bp.route("/buscar_producto/<string:codigo_barras>", methods=["GET"])
def buscar_producto_por_codigo(codigo_barras: str):
    try:
        producto_final = consultar_detalle_producto(codigo_barras)
        if producto_final is None:
            return abort(404, description=f"Código '{codigo_barras}' no encontrado.")
        return jsonify(producto_final), 200
    except ConnectionError:
        return abort(500, description="Error al conectar con la Base de Datos.")

@api_bp.route('/tasa') 
def get_bcv_rate():
    try:
        tasa = tasa_del_dia()
        return jsonify({"tasa": tasa})
    except Exception as e:
        return jsonify({"error": "No se pudo obtener la tasa", "details": str(e)}), 500


@api_bp.route('/my_ip')
def get_my_ip():
    """Devuelve la IP del cliente que hace la petición.

    Prioriza cabeceras estándar de proxy (`X-Forwarded-For`, `X-Real-IP`) y
    finalmente `request.remote_addr`.
    """
    try:
        # X-Forwarded-For puede contener una lista de IPs; tomamos la primera
        xff = request.headers.get('X-Forwarded-For', '')
        if xff:
            ip = xff.split(',')[0].strip()
        else:
            ip = request.headers.get('X-Real-IP') or request.remote_addr or '127.0.0.1'
        return jsonify({"ip": ip}), 200
    except Exception:
        return jsonify({"ip": '127.0.0.1'}), 200 

@api_bp.route('/search-voice', methods=["GET"] )
def search_voice():
    #data = request.get_json()
    #query = data.get('query', '')
    
    query = request.args.get('q', '')
    if not query:
        return jsonify({"error": "No se recibió transcripción"}), 400 
    print(f"DEBUG: Buscando transcripción: {query}") 
    
    # Aquí obtendrías tus productos de la base de datos
    # productos = db.get_products() 
    productos_mock = [{"id": 1, "nombre": "Aceite de Girasol", "precio": 10.5}, ...]

    resultados = SearchService.fuzzy_search_products(query)
    
    return jsonify(resultados), 200