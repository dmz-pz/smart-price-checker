from waitress import serve
from app import app  # Importa el objeto 'app' de tu archivo app.py

if __name__ == "__main__":
    print("Iniciando servidor de producción en Windows Server 2025...")
    print("Acceso local: http://localhost:5020")
    
    # threads=6 permite manejar 6 peticiones pesadas al mismo tiempo
    serve(app, host='0.0.0.0', port=5020, threads=6)