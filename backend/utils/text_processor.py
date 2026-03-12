import re

def clean_voice_text(text):
    # Convertir a minúsculas y quitar caracteres especiales
    text = text.lower().strip()
    # Eliminar palabras "muletilla" de búsqueda por voz
    stop_words = ["búscame", "busca", "necesito", "dime el precio de"]
    for word in stop_words:
        text = text.replace(word, "")
    return text.strip()