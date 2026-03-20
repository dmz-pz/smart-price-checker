/**
 * Módulo JavaScript para el Verificador de Precios Kiosco V1 (Optimizado).
 * Controla la lógica de conexión, estados de UI y gestión de periféricos de entrada.
 *
 * ── NUEVO EN ESTA VERSIÓN ──────────────────────────────────────────────────────
 *  • Búsqueda por voz: el usuario puede dictar un nombre de producto y el sistema
 *    consulta /search-voice, que internamente usa rapidfuzz para encontrar
 *    los resultados más parecidos en el catálogo.
 *
 *  • Bento Grid: cuando la búsqueda retorna múltiples resultados (modo voz o
 *    descripción con varios candidatos), se muestra una grilla de tarjetas en
 *    lugar del detalle directo. Cada tarjeta tiene el nombre, precio y un
 *    indicador visual de confianza (% de coincidencia).
 *
 *  • Selección desde el Bento Grid: al tocar/clicar una tarjeta, se llama a
 *    /buscar_producto/<id> para obtener el detalle completo y se reutiliza
 *    displayProduct(), la función que ya existía en ui.js.
 *
 *  • Estado 'bento': se añadió un nuevo modo al orquestador updateUI() para
 *    manejar este estado intermedio sin romper los estados anteriores (loading,
 *    error, product, idle).
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── Configuración ──────────────────────────────────────────────────────────────
const API_BASE_URL = 'http://192.168.15.103:5020/api/v1';
const ENABLE_MOCK_DESC = true;

// ── Estado Global ──────────────────────────────────────────────────────────────
//
// Estas variables viven durante toda la sesión de la página. Son "globales" en el
// sentido de que cualquier función del módulo puede leerlas y modificarlas.
// Se usan `let` (en lugar de `const`) porque su valor cambia con cada acción.
//
let searchAbortController = null;   // Permite cancelar una petición fetch en curso
let autoHideTimer        = null;    // setTimeout que oculta la tarjeta de producto
let errorTimer           = null;    // setTimeout que limpia el mensaje de error
let lastConfettiAt       = 0;       // Timestamp del último confetti (antiflood)
const CONFETTI_COOLDOWN_MS = 6000;

// Buffer del lector de códigos de barras físico
// El escáner envía los dígitos como eventos 'keydown' muy rápido y luego un Enter.
// Acumulamos esos dígitos aquí cuando el input del formulario no está enfocado.
let __scanBuffer     = '';
let __scanClearTimer = null;

// Guarda el último producto mostrado en pantalla.
// Se usa cuando llega un nuevo escaneo mientras ya hay una tarjeta visible:
// en lugar de limpiar la pantalla (parpadeo feo), mantenemos la carta actual
// mientras carga la nueva (estado keepProduct).
let currentProduct = null;

// ── Importaciones ──────────────────────────────────────────────────────────────
import PriceAPI from './api/price-api.js';
import {
    getElements,
    displayProduct,
    fitProductCard,
    renderInitialLogo,
    renderBentoGrid,   // NUEVO: renderiza la grilla de múltiples resultados
} from './ui/ui.js';

// Cliente API: encapsula fetch, AbortController y los mocks de desarrollo.
const priceApi = new PriceAPI({ baseUrl: API_BASE_URL, enableMock: ENABLE_MOCK_DESC });

// Referencias a nodos del DOM (se rellenan en getDOMElements() al cargar la página).
let inputElement, statusElement, resultElement, searchButton, formElement, headerElement;
let elements = null;


// ── Utilidades de Temporizadores ───────────────────────────────────────────────

/**
 * Cancela todos los setTimeout activos.
 *
 * ¿Por qué es necesario?
 * Si el usuario escanea un producto y, antes de que pasen los 5 s del auto-ocultar,
 * escanea otro, habría DOS timers corriendo al mismo tiempo. El primero podría
 * ocultar la pantalla justo cuando el segundo acaba de mostrar su resultado.
 * Llamar a esta función al inicio de updateUI() elimina ese problema.
 */
function clearAllTimers() {
    if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
    if (errorTimer)    { clearTimeout(errorTimer);    errorTimer    = null; }
}


// ── Restrictor de Foco ─────────────────────────────────────────────────────────

/**
 * Mantiene el foco siempre en el input de búsqueda.
 *
 * En un kiosco físico el usuario no tiene teclado; el foco debe estar en el input
 * para que el lector de código de barras envíe los caracteres al lugar correcto.
 * Se añade/retira como listener de 'click' según si hay o no un producto en pantalla
 * (cuando hay un producto, el formulario está oculto y no tiene sentido forzar el foco).
 */
const focusRestrictor = (e) => {
    if (inputElement && e.target !== inputElement) inputElement.focus();
};


// ── Inicialización del DOM ─────────────────────────────────────────────────────

/**
 * Obtiene y almacena las referencias a los nodos del DOM.
 *
 * Se llama una sola vez en DOMContentLoaded. getElements() está definido en ui.js
 * y devuelve un objeto { input, status, result, form, header, searchButton }.
 */
function getDOMElements() {
    elements     = getElements();
    inputElement  = elements.input;
    statusElement = elements.status;
    resultElement = elements.result;
    searchButton  = elements.searchButton;
    formElement   = elements.form;
    headerElement = elements.header;
}


// ── Orquestador Principal de la UI ────────────────────────────────────────────
//
// updateUI() es el "director de orquesta": recibe un objeto `state` que describe
// QUÉ debe mostrarse, y se encarga de actualizar TODO el DOM de forma coherente.
//
// Estados posibles (las claves del objeto `state`):
//
//   { loading: true }                      → Cargando (spinner amarillo)
//   { loading: true, keepProduct: true }   → Cargando mientras se mantiene la carta actual
//   { error: 'mensaje' }                   → Error (rojo, desaparece en 5 s)
//   { product: {...} }                     → Detalle de un solo producto
//   { bentoResults: [...] }                → NUEVO: grilla de múltiples resultados
//   { loading: false }                     → Vista inicial (logo)
//
// El diseño de "un único punto de verdad para la UI" evita inconsistencias como
// tener el botón deshabilitado pero el spinner oculto, o dos mensajes a la vez.
//
function updateUI(state) {
    if (!inputElement || !statusElement || !resultElement) return;

    // ── Paso 0: Inyección de keepProduct ────────────────────────────────────
    // Si se pide `keepProduct` pero no hay `product` en el estado, tomamos el
    // producto que ya estaba mostrándose (currentProduct) y lo mantenemos.
    // Esto evita un parpadeo de pantalla mientras llega la siguiente búsqueda.
    if (!state.product && state.keepProduct && currentProduct) {
        state.product = currentProduct;
    }

    // ── Paso 1: Limpiar timers anteriores ───────────────────────────────────
    clearAllTimers();

    // ── Paso 2: Visibilidad del header y formulario ──────────────────────────
    // Cuando mostramos un producto O el bento grid, ocultamos el encabezado y el
    // formulario para aprovechar toda la pantalla del kiosco.
    const isFullscreen = Boolean(state.product || state.bentoResults);

    if (isFullscreen) {
        headerElement?.classList.add('hidden');
        formElement?.classList.add('hidden-input');
        document.body.classList.add('no-scroll');
        document.removeEventListener('click', focusRestrictor);
    } else {
        headerElement?.classList.remove('hidden');
        formElement?.classList.remove('hidden-input');
        document.body.classList.remove('no-scroll');
        document.addEventListener('click', focusRestrictor);
        inputElement.focus();
    }

    // ── Paso 3: Estado del input y botón ────────────────────────────────────
    // Deshabilitamos los controles durante la carga para evitar búsquedas paralelas.
    inputElement.disabled = state.loading;
    if (searchButton) searchButton.disabled = state.loading;

    // ── Paso 4: Mensajes de estado (loading / error) ─────────────────────────
    statusElement.innerHTML = '';

    if (state.loading && !state.keepProduct) {
        // Mostramos "Cargando..." solo si no estamos manteniendo una carta visible.
        statusElement.innerHTML = `
            <div class="text-4xl text-yellow-400 animate-pulse mt-8">Cargando...</div>
        `;
    } else if (state.error) {
        statusElement.innerHTML = `
            <div class="text-3xl text-red-500 font-bold p-6 bg-red-100 rounded-xl shadow-lg mt-8">
                ${state.error}
            </div>
        `;
        // Auto-limpiar el error tras 5 segundos → vuelve a vista inicial.
        errorTimer = setTimeout(() => updateUI({ loading: false }), 5000);
    }

    // ── Paso 5: Área de resultados ───────────────────────────────────────────
    resultElement.innerHTML = '';

    if (state.product) {
        // ── CASO A: Producto único ──────────────────────────────────────────
        // Guardamos referencia para keepProduct y llamamos al renderizador de ui.js.
        currentProduct = state.product;
        displayProduct(elements, state.product);

        // Auto-ocultar con animación fade-out tras 5 segundos.
        const ANIM_IN_DURATION = 420;  // debe coincidir con slideUpFade en CSS
        const DISPLAY_TIME     = 5000; // tiempo que el producto permanece visible

        const card = resultElement.querySelector('.product-card');

        // 1. Esperar que termine la animación de entrada antes de aplicar fitProductCard,
        //    evita el conflicto entre el transform del CSS y el scale de JS.
        card.addEventListener('animationend', () => {
            fitProductCard(elements);
        }, { once: true });

        // 2. El auto-ocultar empieza a contar DESPUÉS de que la animación de entrada termina,
        //    así el usuario siempre ve los 5 segundos completos del producto sin interferencias.
        autoHideTimer = setTimeout(() => {
            const activeCard = resultElement.querySelector('.product-card');
            if (activeCard) {
                activeCard.classList.remove('fade-in');
                activeCard.classList.add('fade-out');
                setTimeout(() => {
                    updateUI({ loading: false });
                    inputElement.value = '';
                }, 420);
            } else {
                updateUI({ loading: false });
            }
        }, ANIM_IN_DURATION + DISPLAY_TIME); // 420ms + 5000ms = 5420ms

    } else if (state.bentoResults) {
        // ── CASO B: Múltiples resultados → Bento Grid ──────────────────────
        //
        // `state.bentoResults` es el array que devuelve /search-voice.
        // Cada elemento tiene al menos: { id/codigo_barras, nombre,
        //   precio_final_local, precio_en_dolares, confidence }.
        //
        // renderBentoGrid() (en ui.js) dibuja las tarjetas y registra los
        // listeners de clic. Cuando el usuario toca una tarjeta, llama al
        // callback onSelect que le pasamos aquí: handleBentoSelect().
        //
        // El bento grid NO tiene auto-ocultar: permanece hasta que el usuario
        // seleccione un producto O el escáner reciba un nuevo código.
        currentProduct = null; // No hay producto único activo
        renderBentoGrid(elements, state.bentoResults, handleBentoSelect);

    } else if (!state.loading && !state.error) {
        // ── CASO C: Estado limpio → Vista inicial ───────────────────────────
        currentProduct = null;
        renderInitialLogo(elements);
    }
}


// ── Comunicación con el Backend ───────────────────────────────────────────────

/**
 * Busca un producto por código de barras o descripción de texto.
 *
 * Delega en `priceApi` (PriceAPI) que maneja internamente:
 *   - AbortController para cancelar peticiones anteriores en vuelo
 *   - Mocks de desarrollo cuando ENABLE_MOCK_DESC = true
 *
 * @returns {Object|null} El producto encontrado, o null si hubo error/cancelación.
 */
async function searchProduct(query, { byDescription = false } = {}) {
    const q = String(query).trim();
    try {
        return byDescription
            ? await priceApi.searchByDescription(q)
            : await priceApi.searchByCode(q);
    } catch (err) {
        if (err?.name === 'AbortError') return null; // Cancelación normal, no es error
        updateUI({ loading: false, error: err?.message || String(err) });
        return null;
    }
}

/**
 * NUEVO: Consulta el endpoint de búsqueda por voz y devuelve el array de resultados.
 *
 * Llama a GET /search-voice?q=<transcripcion>.
 * El backend (search_service.py) usa rapidfuzz para devolver los N productos
 * más parecidos con su porcentaje de confianza (campo `confidence`).
 *
 * @param {string} transcripcion  Texto transcripto del habla del usuario.
 * @returns {Array|null}  Array de productos con campo `confidence`, o null si falla.
 */
async function searchVoice(transcripcion) {
    const q = String(transcripcion).trim();
    if (!q) return null;
    try {
        const res = await fetch(
            `${API_BASE_URL}/search-voice?q=${encodeURIComponent(q)}`
        );
        if (!res.ok) throw new Error(`Error ${res.status} en búsqueda por voz`);
        const resultados = await res.json();
        return Array.isArray(resultados) && resultados.length > 0 ? resultados : null;
    } catch (err) {
        updateUI({ loading: false, error: err?.message || 'Error en búsqueda por voz' });
        return null;
    }
}


// ── Detección de Tipo de Entrada ──────────────────────────────────────────────

/**
 * Determina si una cadena es un código de barras.
 * Un código de barras es una secuencia numérica de 6 o más dígitos.
 * Cualquier otra cosa (letras, espacios) se trata como texto descriptivo.
 */
function isBarcode(text) {
    return /^\d{6,}$/.test(String(text).trim());
}


// ── Manejadores de Flujo de Búsqueda ─────────────────────────────────────────

/**
 * NUEVO: Manejador para cuando el usuario selecciona una tarjeta del Bento Grid.
 *
 * Flujo:
 *   1. El usuario ve el bento grid con N opciones.
 *   2. Toca una tarjeta → se llama esta función con el resumen del producto.
 *   3. Si el resumen ya tiene precio_final_local, mostramos el detalle directamente
 *      (ahorra una petición al servidor).
 *   4. Si solo tenemos el id/codigo_barras, hacemos GET /buscar_producto/<id>
 *      para obtener todos los campos y mostramos el detalle completo.
 *
 */
async function handleBentoSelect(productoResumen) {
    updateUI({ loading: true });
 
    const codigo = productoResumen.codigo_barras ?? productoResumen.id;
 
    try {
        const res = await fetch(`${API_BASE_URL}/buscar_producto/${codigo}`);
        if (!res.ok) throw new Error(`Producto '${productoResumen.nombre}' no encontrado`);
        const productoCompleto = await res.json();
        updateUI({ loading: false, product: productoCompleto });
    } catch (err) {
        updateUI({ loading: false, error: err?.message || 'Error al cargar el producto' });
    }
}

/**
 * Manejador para escaneos recibidos cuando el input principal no está enfocado.
 *
 * Esto ocurre cuando hay una tarjeta de producto en pantalla (el formulario está
 * oculto). El escáner de código de barras sigue enviando teclas al documento,
 * y las acumulamos en __scanBuffer. Al llegar Enter, llamamos aquí.
 *
 * Usa `keepProduct: true` para no limpiar la pantalla mientras carga el nuevo
 * producto → el usuario ve la transición sin parpadeo.
 */
async function handleScannedCode(code) {
    try {
        inputElement.value = code;
        const keep = Boolean(resultElement.querySelector('.product-card'));
        updateUI({ loading: true, keepProduct: keep });
        const producto = await searchProduct(code, { byDescription: !isBarcode(code) });
        if (producto) updateUI({ loading: false, product: producto });
        inputElement.value = '';
    } catch (e) {
        updateUI({ loading: false, error: e.message });
    }
}


// ── Inicialización y Eventos ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    getDOMElements();
    updateUI({ loading: false }); // Arranca en vista inicial (logo)

    // ── Mostrar IP del dispositivo en el footer ──────────────────────────────
    // Útil en kioscos para saber rápidamente qué terminal está teniendo problemas.
    (async function fetchDeviceIp() {
        try {
            const resp = await fetch(`${API_BASE_URL}/my_ip`);
            if (!resp.ok) return;
            const data = await resp.json();
            const deviceIp = document.getElementById('device-ip');
            if (deviceIp && data?.ip) deviceIp.textContent = data.ip;
        } catch (_) { /* Silenciar */ }
    })();

    // ── Capturador global del lector de código de barras físico ─────────────
    //
    // Cuando hay un producto en pantalla, el formulario de búsqueda está oculto
    // (clase 'hidden-input'). El escáner envía teclas al documento, no al input.
    // Este listener las captura, las acumula en __scanBuffer (con timeout de 120 ms
    // para separar escaneos consecutivos) y al recibir Enter procesa el buffer.
    //
    window.addEventListener('keydown', (ev) => {
        // Si el foco YA está en el input, el formulario 'submit' lo maneja.
        if (document.activeElement === inputElement) return;

        if (ev.key === 'Enter') {
            if (__scanBuffer.length > 0) {
                ev.preventDefault();
                const code = __scanBuffer;
                __scanBuffer = '';
                clearTimeout(__scanClearTimer);
                handleScannedCode(code);
            }
            return;
        }

        if (ev.key.length === 1) { // Solo caracteres imprimibles
            __scanBuffer += ev.key;
            clearTimeout(__scanClearTimer);
            __scanClearTimer = setTimeout(() => { __scanBuffer = ''; }, 120);
        }
    });

    // ── Submit del formulario de búsqueda manual ─────────────────────────────
    //
    // El usuario puede escribir en el input y presionar Enter o el botón.
    // La lógica detecta automáticamente si es:
    //   • Código de barras (solo dígitos, ≥6) → GET /buscar_producto/<codigo>
    //   • Texto descriptivo (letras/espacios)  → GET /search-voice?q=<texto>
    //     que devuelve múltiples candidatos → Bento Grid
    //
    formElement?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = inputElement.value.trim();
        if (!input) return;

        updateUI({ loading: true });

        if (isBarcode(input)) {
            // ── Búsqueda directa por código ──────────────────────────────────
            const producto = await searchProduct(input, { byDescription: false });
            if (producto) updateUI({ loading: false, product: producto });

        } else {
            // ── Búsqueda por texto/voz → posiblemente múltiples resultados ──
            //
            // searchVoice llama a /search-voice que usa rapidfuzz internamente.
            // Si retorna un array con más de 1 elemento, mostramos el Bento Grid.
            // Si retorna exactamente 1 elemento, vamos directo al detalle.
            // Si retorna null (error o sin resultados), updateUI ya mostró el error.
            //
            const resultados = await searchVoice(input);
            if (!resultados) {
                // Sin resultados o error ya manejado en searchVoice()
            } else if (resultados.length === 1) {
                // Un único match con alta confianza: ir directo al detalle
                await handleBentoSelect(resultados[0]);
            } else {
                // Múltiples candidatos: mostrar bento grid para que el usuario elija
                updateUI({ loading: false, bentoResults: resultados });
            }
        }

        inputElement.value = '';
    });
});


// ── Eventos de Ventana ────────────────────────────────────────────────────────

// Recalcular el scale de la tarjeta de producto al cambiar el tamaño de ventana.
// Se aplica debounce (100 ms) para no ejecutarlo en cada píxel del redimensionado.
window.addEventListener('resize', () => {
    clearTimeout(window.__fitTimeout);
    window.__fitTimeout = setTimeout(() => fitProductCard(elements), 100);
});

// En dispositivos móviles/tablets, el cambio de orientación también dispara un recálculo.
window.addEventListener('orientationchange', () => setTimeout(() => fitProductCard(elements), 200));
