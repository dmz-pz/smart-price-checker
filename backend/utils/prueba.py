import requests
import json

def leer_datos_a2():
    # Sustituye 'localhost' por la IP de tu PC con Delphi si lo pruebas desde otro equipo
    # Ejemplo: 'http://192.168.1.50:9000/CodeBar'
    url = "http://192.168.81.50:9000/producto/00004"

    try:
        print(f"Conectando a la API en: {url}...")
        
        # Realizamos la petición GET
        response = requests.get(url, timeout=10)

        # Verificamos si la respuesta es exitosa (Status Code 200)
        if response.status_code == 200:
            print("Respuesta cruda del servidor:", response.text)
            
            if not response.text.strip():
                print("El servidor envió una respuesta vacía.")
                return

            datos = response.json()
            
            if not datos:
                print("La tabla SCodeBar está vacía.")
                return

            print("\n--- DATOS OBTENIDOS DE SCodeBar ---")
            # Iteramos sobre los registros obtenidos
            for registro in datos:
                # Aquí puedes imprimir los nombres de los campos de tu tabla a2
                # Por ejemplo, si tienes campos 'CODIGO' y 'DESCRIPCION':
                print(f"Registro: {registro}")
            
            print(f"\nTotal de registros: {len(datos)}")
        else:
            print(f"Error en el servidor: Código {response.status_code}")

    except requests.exceptions.ConnectionError:
        print("Error: No se pudo conectar al servidor. ¿Está el API en Delphi ejecutándose?")
    except Exception as e:
        print(f"Ocurrió un error inesperado: {e}")

if __name__ == "__main__":
    leer_datos_a2()