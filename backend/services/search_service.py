# El modulo permite realizar una busqueda parcial en base a la transcripcion del usuario.
# obtiene los productos de la base de datos donde posteriormente pasan hacer filtrados al igual
# que la transcripcion donde mediante la funcionalidad de la libreria rapidfuzz devuelve5 valores 
# mas semejantes a la busqueda del usuario  

import threading
import time
import logging
from rapidfuzz import process, utils, fuzz
# Importamos la función desde tu capa de base de datos
from database.queries.products import obtener_catalogo_busqueda

# Configuración del logger para auditoría de búsquedas
logging.basicConfig(
    filename='busquedas_voz.log',
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)

STOP_WORDS = {
    'cual', 'es', 'el', 'la', 'lo', 'los', 'las', 'precio', 'de', 'del', 'que', 
    'tiene', 'tienen', 'costo', 'vale', 'venden', 'busco', 'necesito', 'dame', 
    'cuanto', 'cuesta', 'un', 'una', 'en', 'donde', 'esta', 'estos', 'para'
} 

class SearchService:
    _cached_products = []
    _cached_names = []
    _lock = threading.Lock()
    _intervalo_segundos = 3600  # Actualizar cada hora es suficiente para nombres

    @classmethod
    def _clean_query(cls, query):
        """
        Extrae el posible nombre del producto eliminando el 'ruido' de la oración.
        """
        # 1. Normalización básica (minúsculas, quitar acentos)
        query_norm = utils.default_process(query)
        
        # 2. Tokenización y filtrado de palabras cortas y stopwords
        tokens = query_norm.split()
        tokens_limpios = [t for t in tokens if t not in STOP_WORDS and len(t) > 1]
        
        # Si después de limpiar no queda nada (ej: "hola"), devolvemos la query original procesada
        producto_filtrado = " ".join(tokens_limpios) if tokens_limpios else query_norm
        return  producto_filtrado
    
    @classmethod
    def start_background_sync(cls):
        """Inicia la sincronización automática en un hilo separado."""
        thread = threading.Thread(target=cls._update_loop, daemon=True)
        thread.start()

    @classmethod
    def _update_loop(cls):
        while True:
            cls.load_from_database()
            time.sleep(cls._intervalo_segundos)

    @classmethod
    def load_from_database(cls):
        """Carga los datos reales de Sybase a la memoria RAM."""
        print("🔄 Sincronizando catálogo real desde Sybase...")
        data = obtener_catalogo_busqueda()
        
        if data:
            with cls._lock:
                cls._cached_products = data
                # Pre-procesamos los nombres para máxima velocidad de respuesta
                cls._cached_names = [utils.default_process(p['nombre']) for p in data]
            print(f"✅ Caché lista: {len(data)} productos cargados.")
        else:
            print("⚠️ No se pudieron cargar datos desde la base de datos.")

    @classmethod
    def fuzzy_search_products(cls, query):
        if not query: return []

        # --- MEJORA AQUÍ: Limpieza de la consulta ---
        producto_buscado = cls._clean_query(query)
        print(f"🔍 Buscando entidad extraída: '{producto_buscado}'")

        if not producto_buscado: return []

        with cls._lock:
            # Usamos token_set_ratio: Muy efectivo para encontrar "pepsi" dentro de "Pepsi Cola 1.5L"
            # Ignora el orden y las palabras que no coinciden en la frase larga.
            matches = process.extract(
                producto_buscado, 
                cls._cached_names, 
                scorer=fuzz.token_set_ratio,
                limit=5,
                score_cutoff=45 # Ignorar resultados con menos de 45% de coincidencia
            )

            results = []
            for _, score, idx in matches:
                producto = cls._cached_products[idx].copy()
                producto['confidence'] = round(score, 2)
                results.append(producto)

            # Ordenar por confianza de mayor a menor
            return sorted(results, key=lambda x: x['confidence'], reverse=True)
        
if __name__ == "__main__":
    # 1. Forzamos la carga inicial de datos reales
    SearchService.load_from_database()

    # 2. Simulamos una entrada de voz
    busqueda_voz = "Cuanto cuesta el arroz mary" 
    print(f"\n🎤 Usuario dice: '{busqueda_voz}'")
    
    resultados = SearchService.fuzzy_search_products(busqueda_voz)

    if resultados:
        print("\n--- Sugerencias para el Bento Grid ---")
        for res in resultados:
            print(f"ID: {res['id']} | Nombre: {res['nombre']} | Match: {res['confidence']}%")
    else:
        print("\n❌ No se encontraron productos similares.")