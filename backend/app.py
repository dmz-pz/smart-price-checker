from flask import Flask
from flask_cors import CORS
from routes.views import views_bp
from routes.api import api_bp
from services.search_service import SearchService 
import os
from dotenv import load_dotenv 

load_dotenv()

class Config:
    DEBUG = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    PORT = int(os.environ.get('PORT', 5020))

app = Flask(
    __name__,
    static_folder="../frontend/src",
    static_url_path="",
    template_folder="../frontend/src"
)
app.config.from_object(Config)
CORS(app)

# 1. Iniciar la carga de datos en segundo plano al arrancar la app
#earchService.start_background_sync() 

# REGISTRO DE BLUEPRINTS
app.register_blueprint(views_bp)

# Al agregar url_prefix, tus rutas ahora serán /api/v1/tasa, etc.
app.register_blueprint(api_bp, url_prefix='/api/v1') 

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=app.config['DEBUG'], port=app.config['PORT'])