# Verificador de precios inteligente
Interfaz gráfica inteligente para verificadores de precios con búsqueda multimodal.
## Instalacion
Creamos un entorno virtual
```bash
python -m venv nombre-para-tu-entorno
```
Instalamos las librerias necesarias para el proyecto. 
```bash 
pip install -r requirements.txt
``` 
Este proyecto utiliza Tailwind CLI para gestionar los estilos de forma local, evitando la dependencia de CDNs externos y optimizando el rendimiento.
```bash 
npm install
``` 
## Ejecucion
1. **Compilar estilos de (Tailwind):**
    Manten esta terminal abierta para que los cambios en el diseño se atualicen automaticamente: 
    ```bash
        npx tailwindcss -i ./static/src/input.css -o ./static/dist/output.css --watch
    ```
2. **Iniciar servidor Flask:**
    python app.py 

### Tecnologias utilizadas 

* **Backend:** Python 3.13.5+** 
* **Node.js y npm** (Necesarios para la CLI de Tailwind) 

### Estrcutura del proyecto en capas
```text
|--backend/
|    |-- database/
|        |-- queries/
|    |-- routes/
|    |-- services/
|    |-- utils/
|--- |app.py
|--- |server.py
|--- |.env
|--frontend/
|       |-- src/
|       |    |-- assets/
|       |    |-- css/
|       |    |-- js/
|       |        |-- api/
|       |        |-- ui/
|       |        |-- utils/    
|       |------ index.html
|       |------ input.css
|       |------ output.css
|       |------ tailwind.conf  
|-- logs/          
```