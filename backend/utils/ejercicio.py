productos = {
    'categoria': {
        'pantalon': {
            'Jean Azul': 10.5,
            'Jean Negro': 5,
            'Jean Verde': 15,
            'Jean Rojo': 18.5,
            'Jean Amarillo': 7.5,
            'Jean Naranaja': 11.5,
        },
        'camisa': {
            'Camisa blanca' : 10,
            'Camisa blanca' : 18,
            'Camisa blanca' : 8,
            'Camisa blanca' : 15,
        }
    } 
    
} 

def Productos(lista_productos, categoria): 
    for iterador in lista_productos['categoria']:
        if categoria == iterador:
            producto_por_categoria = lista_productos['categoria'].get(categoria, 'La categoria buscada no existe')
            total = sum(p for p in producto_por_categoria.values() if p > 10)
            print(f'El precio total de categoria {categoria} es {total}')

Productos(productos, 'pantalon')