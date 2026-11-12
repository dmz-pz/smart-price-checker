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
                b.cod_barra,
                p.txt_descripcion_larga,
                pre.mto_precio,
                imp.porc_impuesto,
                p.ind_pesado,
                p.cod_departamento,
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


import logging

def obtener_columnas_tabla(nombre_tabla: str, schema: str = 'DBA'):
        """
        Obtiene el listado de columnas, tipo de dato y si admite nulos de una tabla 
        en SAP SQL Anywhere / Sybase.
        """
        try:
            with MiConexionBD() as db:
                query = """
                    SELECT 
                        c.column_name,
                        d.domain_name AS tipo_dato,
                        c.width AS longitud,
                        c.nulls AS permite_nulos
                    FROM SYS.SYSTAB t
                    JOIN SYS.SYSCOLUMN c ON t.table_id = c.table_id
                    JOIN SYS.SYSUSERPERM u ON t.creator = u.user_id
                    JOIN SYS.SYSDOMAIN d ON c.domain_id = d.domain_id
                    WHERE u.user_name = ?
                    AND t.table_name = ?
                    ORDER BY c.column_id
                """
                cursor = db.cursor()
                cursor.execute(query, (schema, nombre_tabla))
                
                columns = [col[0] for col in cursor.description]
                resultados = [dict(zip(columns, row)) for row in cursor.fetchall()]

                if not resultados:
                    logging.warning(f"No se encontraron columnas para '{schema}.{nombre_tabla}'.")

                return resultados

        except ConnectionError as e:
            logging.error(f"Error de conexión al inspeccionar '{schema}.{nombre_tabla}': {e}")
            raise
        except Exception as e:
            logging.error(f"Error al obtener columnas de '{schema}.{nombre_tabla}': {e}")
            return []

def obtener_tipo_campo(nombre_tabla: str, nombre_columna: str, schema: str = 'DBA'):
    """
    Retorna la información del tipo de dato de un campo específico.
    """
    try:
        with MiConexionBD() as db:
            query = """
                SELECT 
                    c.column_name,
                    d.domain_name AS tipo_dato,
                    c.width AS longitud,
                    c.nulls AS permite_nulos
                FROM SYS.SYSTAB t
                JOIN SYS.SYSCOLUMN c ON t.table_id = c.table_id
                JOIN SYS.SYSUSERPERM u ON t.creator = u.user_id
                JOIN SYS.SYSDOMAIN d ON c.domain_id = d.domain_id
                WHERE u.user_name = ?
                  AND t.table_name = ?
                  AND c.column_name = ?
            """
            cursor = db.cursor()
            cursor.execute(query, (schema, nombre_tabla, nombre_columna))
            row = cursor.fetchone()

            if not row:
                logging.warning(f"No se encontró el campo '{nombre_columna}' en '{schema}.{nombre_tabla}'.")
                return None

            columns = [col[0] for col in cursor.description]
            return dict(zip(columns, row))

    except ConnectionError as e:
        logging.error(f"Error de conexión al consultar campo '{nombre_columna}': {e}")
        raise
    except Exception as e:
        logging.error(f"Error al obtener tipo de dato: {e}")
        return None

def mostrar_columnas_tabla(nombre_tabla: str, schema: str = 'DBA'):
    """
    Imprime de forma formateada y numerada las columnas de una tabla.
    """
    columnas = obtener_columnas_tabla(nombre_tabla, schema)
    
    if not columnas:
        print(f"\n[!] No se encontraron columnas para la tabla: {schema}.{nombre_tabla}\n")
        return

    ancho_titulo = 40
    print("\n" + "=" * ancho_titulo)
    print(f" TABLA: {schema}.{nombre_tabla}".center(ancho_titulo))
    print(f" Total columnas: {len(columnas)}".center(ancho_titulo))
    print("=" * ancho_titulo)
    print(f"{'#':<4} | {'Nombre de Columna'}")
    print("-" * ancho_titulo)

    for idx, col in enumerate(columnas, start=1):
        print(f"{idx:<4} | {col.get('column_name')}")

    print("=" * ancho_titulo + "\n") 


def inspeccionar_campo(nombre_tabla: str, nombre_columna: str, schema: str = 'DBA'):
    """
    Muestra en consola el tipo de dato formateado.
    """
    info = obtener_tipo_campo(nombre_tabla, nombre_columna, schema)
    if not info:
        print(f"\n[!] El campo '{nombre_columna}' no existe en {schema}.{nombre_tabla}\n")
        return

    print("\n" + "=" * 45)
    print(f" CAMPO: {schema}.{nombre_tabla}.{nombre_columna}".center(45))
    print("=" * 45)
    print(f" Tipo de Dato   : {info['tipo_dato']}")
    print(f" Longitud/Ancho : {info['longitud']}")
    print(f" Permite Nulos  : {'Sí' if info['permite_nulos'] == 'Y' else 'No'}")
    print("=" * 45 + "\n")

#print(obtener_producto("7591031005988"))
#print(obtener_columnas_tabla("tv_producto"))
# print(obtener_tipo_campo("tv_producto", "cod_departamento"))