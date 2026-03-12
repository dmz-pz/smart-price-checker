from ..client import MiConexionBD

def buscar_cod_interno_por_nombre_o_descripcion(termino: str, limite: int = 20):
    """
    Busca `cod_interno` de productos cuyo nombre o descripción contengan el término dado.
    Devuelve una lista con hasta `limite` códigos encontrados (strings).
    """
    if not termino:
        return []

    termino_like = f"%{termino.lower()}%"
    with MiConexionBD() as db:
        cursor = db.cursor()
        querie = """
            SELECT DISTINCT
                tv_producto.cod_interno,
                tv_barra.cod_barra
            FROM DBA.tv_producto
            LEFT JOIN DBA.tv_barra ON tv_producto.cod_interno = tv_barra.cod_interno
            WHERE
                (
                    LOWER(tv_producto.txt_descripcion_larga) LIKE ?
                    OR LOWER(COALESCE(tv_producto.txt_descripcion_corta, '')) LIKE ?
                )
                AND tv_producto.ind_inactivo = 'A'
            ORDER BY tv_producto.cod_interno
        """
        cursor.execute(querie, (termino_like, termino_like))
        rows = cursor.fetchmany(limite)
        results = []
        for r in rows:
            cod_interno = r[0].strip() if isinstance(r[0], str) else r[0]
            cod_barra = r[1].strip() if len(r) > 1 and isinstance(r[1], str) and r[1] is not None else r[1]
            results.append((cod_interno, cod_barra))
        return results

resultados = buscar_cod_interno_por_nombre_o_descripcion('mandarina') 
print(resultados)