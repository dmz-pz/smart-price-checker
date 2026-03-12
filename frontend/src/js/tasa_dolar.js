/**
 * Lógica para el Verificador de Precios con actualización de tasa BCV.
 */

const API_BASE_URL = 'http://192.168.15.103:5020/api/v1';

// Variables de estado
let lastTasaValue = null;

/**
 * Obtiene la tasa desde la API y actualiza la interfaz.
 */
async function actualizarTasaDolar() {
    const container = document.getElementById('container-dolar');
    if (!container) return;

    try {
        const response = await fetch(`${API_BASE_URL}/tasa`);
        if (!response.ok) throw new Error('Error al obtener tasa');
        
        const data = await response.json();
        const tasa = data.tasa;

        // Solo actualizamos el DOM si el valor cambió para evitar parpadeos innecesarios
        if (tasa !== lastTasaValue) {
            lastTasaValue = tasa;
            renderTasa(tasa);
        }
    } catch (error) {
        console.error('Error actualizando tasa:', error);
        // Si hay error y no teníamos valor previo, mostramos un mensaje sutil
        if (!lastTasaValue) {
            container.innerHTML = `<span class="text-white/30 text-sm italic">Sincronizando tasa...</span>`;
        }
    }
}


/**
 * Renderiza el HTML de la tasa con estilos Glassmorphism.
 */
function renderTasa(valor) {
    const container = document.getElementById('container-dolar');
    if (!container) return;

    container.innerHTML = `
        <div class="flex items-end gap-3 px-5 py-3 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl shadow-lg transition-all hover:scale-105 animate-in fade-in duration-700">
            
            <div class="flex items-center justify-center">
                <img src="assets/img/logo-bcv.webp" alt="BCV" class="w-8 h-8 md:w-10 md:h-10 object-contain brightness-110 contrast-125">
            </div>

            <div class="flex flex-col items-end">
                <div class="flex items-center gap-2">
                    <span class="text-blue-300 text-[6px] md:text-xs uppercase font-bold tracking-widest">Tasa BCV</span>
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                </div>
                <span class="text-white text-xl md:text-3xl font-black tracking-tight">
                    <span class="text-white text-xs md:text-sm text-neutral-400 font-black tracking-tight">Bs.</span> 
                    ${valor.toFixed(2)}
                </span>
            </div>
        </div>
    `;
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Primera carga
    actualizarTasaDolar();

    // Configurar actualización automática cada 5 minutos (300,000 ms)
    setInterval(actualizarTasaDolar, 300000);

    // ... lógica de búsqueda de productos existente ...
    const form = document.getElementById('search-form');
    const input = document.getElementById('barcode-input');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Tu lógica de búsqueda aquí...
        console.log("Buscando producto:", input.value);
    });
});