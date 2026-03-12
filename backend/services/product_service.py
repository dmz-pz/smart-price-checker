from database.queries.products import obtener_producto, obtener_descuento, consulta_bcv
from datetime import date
from decimal import Decimal
from typing import Optional, Dict, Any

# --- FUNCIONES AUXILIARES DE CÁLCULO (Buenas Prácticas) ---

def aplicar_descuento(precio_base: float, porcentaje_descuento: float) -> float:
    """Calcula el precio base aplicando un porcentaje de descuento."""
    if porcentaje_descuento <= 0:
        return precio_base
    factor_descuento = 1 - (porcentaje_descuento / 100)
    return round(precio_base * factor_descuento, 2)

def calcular_precio_base_desde_final(precio_final: float, iva_porcentaje: float) -> float:
    """Calcula el precio sin IVA dado un precio final que ya incluye IVA.

    precio_final = precio_base * (1 + iva_porcentaje/100)
    Por tanto precio_base = precio_final / (1 + iva_porcentaje/100)
    """
    try:
        factor = 1 + (float(iva_porcentaje) / 100)
        if factor == 0:
            return round(float(precio_final), 2)
        return round(float(precio_final) / factor, 2)
    except Exception:
        return round(float(precio_final), 2)

def calcular_precio_final(precio_con_descuento: float, iva_porcentaje: float) -> float:
    """Aplica el IVA al precio ya descontado."""
    factor_iva = 1 + (iva_porcentaje / 100)
    return round(precio_con_descuento * factor_iva, 2)

def convertir_a_dolares(precio_local: float, tasa_cambio: float) -> float:
    """Convierte el precio final a dólares basado en la tasa de cambio vigente."""
    if tasa_cambio > 0:
        return round(precio_local / tasa_cambio, 2)
    return 0.0 

def precio_por_peso(gramos): 
    """Calcula el precio base para una cantidad en gramos usando el precio por kg.

    - `gramos` puede ser int o str con 5 dígitos (ej: '00100').
    - Devuelve una tupla `(gramos_int, kg_float)` lista para cálculos posteriores.
    """
    if gramos is None:
        return 0, 0.0

    try:
        g = int(gramos)
    except (ValueError, TypeError):
        return 0, 0.0

    kg = g / 1000.0
    return g, kg


# --- FUNCIÓN PRINCIPAL DE SERVICIO (Orquestación) ---

def consultar_detalle_producto(cod_barra: str) -> Optional[Dict[str, Any]]:
    # ---------------------------------------------
    # PASO 1: Obtener datos crudos del Producto
    # ---------------------------------------------
    producto_peso = None
    es_pesado = False
    if cod_barra.startswith('21'):
        es_pesado = True
        id_producto_pesado = f'00000000{cod_barra[2:7]}'
        producto_peso = cod_barra[7:12]
        raw_data = obtener_producto(id_producto_pesado)
    else:
        raw_data = obtener_producto(cod_barra) # Asumiendo que has renombrado 'obtener_producto' a 'obtener_producto_raw'

    if not raw_data:
        # Si no hay datos, retorna None (el controlador Flask manejará el 404) 
        return None 
    
    # ---------------------------------------------
    # PASO 2: Mapear y Limpiar datos base
    # ---------------------------------------------
    try:
        # Supongamos que raw_data = (cod_interno, desc, precio, fecha_cambio, impuesto, tasa, inactivo)
        raw_price = float(raw_data[2])
        iva_pct = float(raw_data[3])
        producto: Dict[str, Any] = {
            "id": raw_data[0].strip(),
            "nombre": raw_data[1].strip(),
            # Nota: el campo en BD trae el precio final con IVA; calculamos el precio base real
            "precio_final_db": raw_price,
            "precio_base": calcular_precio_base_desde_final(raw_price, iva_pct),
            "iva_porcentaje": iva_pct,
            "tasa_cambio": float(raw_data[4]),
            # Inicializamos campos de descuento
            "porcentaje_descuento": 0.0,
            "promocion": False,
            "es_pesado": es_pesado,
            "peso_gramos": 0,
        }
        # Si es producto pesado, parseamos gramos y dejamos listo para cálculo
        if es_pesado and producto_peso is not None:
            g, kg = precio_por_peso(producto_peso)
            producto["peso_gramos"] = g
            producto["peso_kg"] = round(kg, 3)
    except Exception as e:
        print(f"ERROR: Fallo al mapear tipos de datos del producto: {e}")
        return None # Retornar None para indicar fallo de procesamiento

    # ---------------------------------------------
    # PASO 3: Obtener Descuento y Preparar Aplicación
    # ---------------------------------------------
    porc_descuento_encontrado = 0.0
    
    try:
        descuento_raw = obtener_descuento(producto['id'], date.today())
        if descuento_raw and descuento_raw[0] is not None:
            porc_descuento_encontrado = float(descuento_raw[0])
            
    except ConnectionError:
        print("Advertencia: Fallo al consultar el módulo de descuentos, se procede sin descuento.")
    
    # Aplicar descuento si es válido
    if porc_descuento_encontrado > 0:
        producto["porcentaje_descuento"] = porc_descuento_encontrado
        producto["promocion"] = True 

    # ---------------------------------------------
    # PASO 4: Aplicar Lógica Financiera
    # ---------------------------------------------
    
    # Aplicar Descuento y cálculos finales.
    if producto.get("es_pesado"):
        gramos = producto.get("peso_gramos", 0)
        kg = producto.get("peso_kg", 0.0)

        # precio_por_kg es el precio (base por kg) ya calculado en producto["precio_base"]
        precio_por_kg_base = producto["precio_base"]
        precio_base_por_peso = round(precio_por_kg_base * kg, 2)
        producto["precio_base_por_peso"] = precio_base_por_peso

        precio_base_aplicado = aplicar_descuento(precio_base_por_peso, producto["porcentaje_descuento"])
        producto["precio_base_aplicado"] = precio_base_aplicado

        precio_final_local = calcular_precio_final(precio_base_aplicado, producto["iva_porcentaje"])
        producto["precio_final_local"] = precio_final_local

        producto["precio_unitario_kg"] = round(precio_por_kg_base, 2)
        producto["precio_en_dolares"] = convertir_a_dolares(precio_final_local, producto["tasa_cambio"])
        producto["iva_monto"] = round(producto["precio_final_local"] - producto["precio_base_aplicado"], 2)
    else:
        # Producto normal por unidad
        # Conservamos `precio_base` original (sin descuento). Calculamos el precio final original (con IVA)
        precio_final_sin_descuento = calcular_precio_final(producto["precio_base"], producto["iva_porcentaje"])
        producto["precio_final_sin_descuento"] = precio_final_sin_descuento

        precio_base_aplicado = aplicar_descuento(
            producto["precio_base"], 
            producto["porcentaje_descuento"]
        )
        producto["precio_base_aplicado"] = precio_base_aplicado
        producto["precio_base"] = precio_base_aplicado
        # Aplicar IVA (reconstruimos el precio final a partir del precio base aplicado)
        precio_final_local = calcular_precio_final(precio_base_aplicado, producto["iva_porcentaje"])
        producto["precio_final_local"] = precio_final_local

        # Convertir a Dólares
        producto["precio_en_dolares"] = convertir_a_dolares(precio_final_local, producto["tasa_cambio"])

        # Exponer monto de IVA (no sobrescribir el porcentaje)
        producto["iva_monto"] = round(producto["precio_final_local"] - producto["precio_base_aplicado"], 2)
    return producto

def tasa_del_dia(): 
        resultado = consulta_bcv()
        tasa_bcv = str(resultado) 
        data = tasa_bcv.strip("()")
        cantidad = eval(data) 
        cantidad_final = float(cantidad[0])  
        return cantidad_final 


#print(consultar_detalle_producto('7592217001466'))
# 
#7591002800062