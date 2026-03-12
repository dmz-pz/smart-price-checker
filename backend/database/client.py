import pyodbc

# Es mejor mover esto a un archivo .env por seguridad
CONFIG = {
    'dsn': 'Conexion_Mine',
    'user': 'lector',
    'pass': 'DsI2018'
}

class MiConexionBD:
    def __init__(self):
        self.cnxn = None

    def __enter__(self):
        """Permite usar la clase con la sentencia 'with'"""
        try:
            self.cnxn = pyodbc.connect(
                f"DSN={CONFIG['dsn']};UID={CONFIG['user']};PWD={CONFIG['pass']}"
            )
            return self.cnxn
        except Exception as e:
            print(f"Error de conexión: {e}")
            raise

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Cierra la conexión automáticamente al salir del bloque 'with'"""
        if self.cnxn:
            self.cnxn.close()