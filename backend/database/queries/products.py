import logging
from ..client import MiConexionBD
from datetime import date

# Configura logging si no está en app.py
logging.basicConfig(level=logging.ERROR)

def obtener_producto(cod_producto):
    try:
        with MiConexionBD() as db:
            querie = """
            SELECT TOP 1 -- Solo queremos el precio más reciente
                p.cod_interno,
                p.txt_descripcion_larga,
                pre.mto_precio,
                imp.porc_impuesto,
                mon.tasa_vig
            FROM DBA.tv_producto AS p
            INNER JOIN DBA.tv_barra AS b ON p.cod_interno = b.cod_interno
            INNER JOIN DBA.ta_precio_producto AS pre ON p.cod_interno = pre.cod_interno
            INNER JOIN DBA.td_tipo_impuesto AS imp ON p.cod_impuesto = imp.cod_impuesto
            CROSS JOIN (SELECT tasa_vig FROM DBA.tb_moneda WHERE cod_internacional = 'USD') AS mon
            WHERE 
                b.cod_barra = ? 
                AND p.ind_inactivo = 'A'
                AND pre.mto_precio > 0
            ORDER BY 
                pre.fecha_cambio DESC
            """
            cursor = db.cursor()
            cursor.execute(querie, (cod_producto,))
            result = cursor.fetchone()
            if result is None:
                logging.warning(f"Producto '{cod_producto}' no encontrado en DB.")
            return result
    except ConnectionError as e:
        # Error crítico: propaga para que app.py lo maneje como 500
        logging.error(f"Error de conexión en obtener_producto para '{cod_producto}': {e}")
        raise
    except Exception as e:
        # Error no crítico (e.g., sintaxis, datos inválidos): log y retorna None
        logging.error(f"Error inesperado en obtener_producto para '{cod_producto}': {e}")
        return None

def obtener_descuento(cod_producto: str, fecha_actual: date = date.today()):
    """
    Obtiene el valor del descuento (porcentaje o monto) activo para un producto específico 
    basado en las tablas td_cliente_evento y tm_cliente_evento.

    Se pasa la fecha actual como parámetro de Python y se utiliza el placeholder '?'.
    """
    # Formateamos la fecha a string para la consulta SQL, si es necesario, 
    # aunque pyodbc generalmente maneja objetos date/datetime directamente.
    fecha_str = fecha_actual.strftime('%Y-%m-%d')
    
    try:
        with MiConexionBD() as db:
            querie = """
                SELECT
                    td_cliente_evento.valor
                FROM
                    DBA.td_cliente_evento
                INNER JOIN
                    DBA.tm_cliente_evento ON td_cliente_evento.id_evento = tm_cliente_evento.id_evento
                WHERE
                    td_cliente_evento.parametro2 = ?
                    AND tm_cliente_evento.tipo_evento = 'L'
                    AND tm_cliente_evento.fecha_inicio <= ?
                    AND tm_cliente_evento.fecha_fin >= ?
            """ 
            cursor = db.cursor()

            # Pasamos los parámetros de forma segura: (parametro2, fecha_inicio, fecha_fin)
            params = (cod_producto, fecha_str, fecha_str)
            cursor.execute(querie, params)
            result = cursor.fetchone()  # Retorna (valor,) o None
            if result is None:
                logging.info(f"No hay descuento activo para '{cod_producto}' en {fecha_actual}.")
            return result
    except ConnectionError as e:
        logging.error(f"Error de conexión en obtener_descuento: {e}")
        raise
    except Exception as e:
        logging.error(f"Error en obtener_descuento para '{cod_producto}': {e}")
        return None

# Consulta para la tasa BCV: 
def consulta_bcv():  
    try:
        with MiConexionBD() as db:
            cursor = db.cursor()
            query = "SELECT tb_moneda.tasa_vig FROM DBA.tb_moneda WHERE tb_moneda.cod_internacional = 'USD'"
            cursor.execute(query)
            return cursor.fetchone()
    except ConnectionError as e:
        logging.error(f"Error de conexión en consulta_bcv: {e}")
        raise
    except Exception as e:
        logging.error(f"Error en consulta_bcv: {e}")
        return None

def obtener_catalogo_busqueda():
    """
    Trae solo nombre y código para la caché de búsqueda difusa.
    Optimizado para no sobrecargar la memoria.
    """
    try:
        with MiConexionBD() as db:
            # Traemos solo lo necesario para identificar y comparar
            query = """
                SELECT 
                    p.txt_descripcion_larga as nombre, 
                    b.cod_barra as id
                FROM DBA.tv_producto AS p
                INNER JOIN DBA.tv_barra AS b ON p.cod_interno = b.cod_interno
                WHERE p.ind_inactivo = 'A'
            """
            cursor = db.cursor()
            cursor.execute(query)
            
            # Convertimos a lista de diccionarios para facilitar el manejo en el service
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
            
    except Exception as e:
        logging.error(f"Error al obtener catálogo de búsqueda: {e}")
        return []



