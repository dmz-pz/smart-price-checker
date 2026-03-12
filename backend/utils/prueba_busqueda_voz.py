import threading
import time
import logging
from rapidfuzz import process, utils, fuzz
# Importamos la función desde tu capa de base de datos
from ..database.queries.products import obtener_catalogo_busqueda

# Configuración del logger para auditoría de búsquedas
logging.basicConfig(
    filename='busquedas_voz.log',
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)

class SearchService:
    _cached_products = []
    _cached_names = []
    _lock = threading.Lock()
    _intervalo_segundos = 3600  # Actualizar cada hora es suficiente para nombres

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

        # 1. Limpieza y tokenización
        # "Cual es el precio de la Coca Cola" -> ['cual', 'precio', 'coca', 'cola']
        tokens_usuario = [p for p in utils.default_process(query).split() if len(p) > 2]

        if not tokens_usuario: return []

        with cls._lock:
            # 2. PUNTAJE DE RELEVANCIA (Pre-filtro inteligente)
            # Evaluamos cada producto: ¿Cuántas palabras del usuario contiene?
            candidatos_indices = []

            for i, nombre_prod in enumerate(cls._cached_names):
                # Contamos cuántas palabras de la consulta están en el nombre del producto
                # Ejemplo para Coca Cola: 'coca' está (1), 'cola' está (1) -> Total 2
                # Ejemplo para el Apresto: 'precio' está (0.5 por coincidencia parcial)
                coincidencias = sum(1 for t in tokens_usuario if t in nombre_prod)

                if coincidencias > 0:
                    candidatos_indices.append((i, coincidencias))

            # 3. FILTRAR POR LOS MEJORES CANDIDATOS
            # Solo nos quedamos con los productos que tengan el máximo de coincidencias
            if candidatos_indices:
                # Ordenamos por cantidad de palabras encontradas
                candidatos_indices.sort(key=lambda x: x[1], reverse=True)
                max_coincidencias = candidatos_indices[0][1]

                # Si el mejor tiene 2 palabras, solo procesamos los que tengan 2 (o al menos 1)
                umbral = max_coincidencias * 0.8
                sub_indices = [idx for idx, count in candidatos_indices if count >= umbral]
            else:
                sub_indices = range(len(cls._cached_names))

            # 4. BÚSQUEDA DIFUSA (Solo sobre los candidatos filtrados)
            nombres_reducidos = [cls._cached_names[i] for i in sub_indices]

            matches = process.extract(
                " ".join(tokens_usuario), 
                nombres_reducidos, 
                scorer=fuzz.partial_ratio,
                limit=6
            )

            # Re-mapeo a objetos originales
            results = []
            for _, score, reduced_idx in matches:
                original_idx = sub_indices[reduced_idx]
                producto = cls._cached_products[original_idx].copy()
                producto['confidence'] = round(score, 2)
                results.append(producto)

            return results
        
if __name__ == "__main__":
    # 1. Forzamos la carga inicial de datos reales
    SearchService.load_from_database()

    # 2. Simulamos una entrada de voz
    busqueda_voz = "Cuanto cuesta el arroz" 
    print(f"\n🎤 Usuario dice: '{busqueda_voz}'")
    
    resultados = SearchService.fuzzy_search_products(busqueda_voz)

    if resultados:
        print("\n--- Sugerencias para el Bento Grid ---")
        for res in resultados:
            print(f"ID: {res['id']} | Nombre: {res['nombre']} | Match: {res['confidence']}%")
    else:
        print("\n❌ No se encontraron productos similares.")