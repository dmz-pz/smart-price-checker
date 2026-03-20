/**
 * Módulo JavaScript para el Verificador de Precios Kiosco V1 (Optimizado).
 * Controla la lógica de conexión, estados de UI y gestión de periféricos de entrada.
 */

const API_BASE_URL = 'http://192.168.15.103:5020/api/v1';
const ENABLE_MOCK_DESC = true;

// --- Estado Global y Controladores ---
let searchAbortController = null;
let autoHideTimer = null;
let errorTimer = null;
let lastConfettiAt = 0;
const CONFETTI_COOLDOWN_MS = 6000;

// Buffer para detectar escaneo desde lector cuando el input no está enfocado
let __scanBuffer = '';
let __scanClearTimer = null;

// Producto actualmente mostrado en la UI (si existe)
let currentProduct = null;

import PriceAPI from './api/price-api.js';
import { getElements, displayProduct, fitProductCard, renderInitialLogo } from './ui/ui.js';

// Instancia del cliente API (encapsula AbortController y mocks)
const priceApi = new PriceAPI({ baseUrl: API_BASE_URL, enableMock: ENABLE_MOCK_DESC });

// Referencias del DOM
let inputElement, statusElement, resultElement, searchButton, formElement, headerElement;
let elements = null;

/**
 * Nota: `formatCurrency` y `launchConfetti` ahora vienen de módulos en `./utils`.
 */

/**
 * Limpia todos los temporizadores activos para evitar solapamiento de estados de UI.
 */
function clearAllTimers() {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }
    if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = null;
    }
}

/**
 * Forzar el foco en el input principal. Definido como referencia fija para evitar duplicados.
 */
const focusRestrictor = (e) => {
    if (inputElement && e.target !== inputElement) {
        inputElement.focus();
    }
};

/**
 * Obtiene las referencias de los elementos del DOM.
 */
function getDOMElements() {
    elements = getElements();
    inputElement = elements.input;
    statusElement = elements.status;
    resultElement = elements.result;
    searchButton = elements.searchButton;
    formElement = elements.form;
    headerElement = elements.header;
}

/**
 * Orquestador principal de la Interfaz de Usuario.
 */
function updateUI(state) {
    if (!inputElement || !statusElement || !resultElement) return;

    // Si nos piden mantener la carta mostrada durante loading, inyectamos el producto
    if (!state.product && state.keepProduct && currentProduct) {
        state.product = currentProduct;
    }

    // 1. Limpieza de seguridad
    clearAllTimers();

    // 2. Control de visibilidad de componentes base
    if (state.product) {
        headerElement?.classList.add('hidden');
        formElement?.classList.add('hidden-input');
        document.body.classList.add('no-scroll');
        document.removeEventListener('click', focusRestrictor);
    } else {
        headerElement?.classList.remove('hidden');
        formElement?.classList.remove('hidden-input');
        document.body.classList.remove('no-scroll');
        // El input se enfoca siempre que no estemos mostrando un producto
        document.addEventListener('click', focusRestrictor);
        inputElement.focus();
    }

    // 3. Manejo de Input y Botón
    inputElement.disabled = state.loading;
    if (searchButton) searchButton.disabled = state.loading;

    // 4. Renderizado de Mensajes de Estado
    statusElement.innerHTML = '';
    const _keepDuringLoading = Boolean(state.keepProduct);
    // Mostrar 'Cargando...' solo cuando no estemos reteniendo la carta actual.
    if (state.loading && !_keepDuringLoading) {
        statusElement.innerHTML = `
            <div class="text-4xl text-yellow-400 animate-pulse mt-8">Cargando...</div>
        `;
    } else if (state.error) {
        statusElement.innerHTML = `
            <div class="text-3xl text-red-500 font-bold p-6 bg-red-100 rounded-xl shadow-lg mt-8">
                ${state.error}
            </div>
        `;
        errorTimer = setTimeout(() => updateUI({ loading: false }), 5000);
    }

    // 5. Renderizado de Resultados
    resultElement.innerHTML = '';
    if (state.product) {
        // Guardar referencia del producto mostrado para futuras llamadas que pidan "keepProduct"
        currentProduct = state.product;
        displayProduct(elements, state.product);

        // Auto-ocultar tras 5 segundos con animación de salida
        autoHideTimer = setTimeout(() => {
            const card = resultElement.querySelector('.product-card');
            if (card) {
                card.classList.remove('fade-in');
                card.classList.add('fade-out');
                setTimeout(() => {
                    updateUI({ loading: false });
                    inputElement.value = '';
                }, 320);
            } else {
                updateUI({ loading: false });
            }
        }, 5000);
    } else if (!state.loading && !state.error) {
        // Al limpiar la vista de producto, también limpiamos currentProduct
        currentProduct = null;
        // Vista Inicial (Logo)
        renderInitialLogo(elements);
    }
}

/**
 * Lógica de comunicación con el Backend delegada a `PriceAPI`.
 */
async function searchProduct(query, { byDescription = false } = {}) {
    const q = String(query).trim();
    try {
        if (byDescription) {
            const product = await priceApi.searchByDescription(q);
            return product;
        } else {
            const product = await priceApi.searchByCode(q);
            return product;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return null;
        updateUI({ loading: false, error: err?.message || String(err) });
        return null;
    }
}

/** Detecta si el input es un código de barras (numérico largo) o texto descriptivo. */
function isBarcode(text) {
    return /^\d{6,}$/.test(String(text).trim());
}

// mockDescriptionSearch moved to PriceAPI (internal mock when enabled)

// --- Eventos Globales ---

document.addEventListener('DOMContentLoaded', () => {
    getDOMElements();
    updateUI({ loading: false });

    // Obtener la IP del dispositivo desde el backend y mostrarla en el footer
    (async function fetchDeviceIp() {
        try {
            const resp = await fetch(`${API_BASE_URL}/my_ip`);
            if (!resp.ok) return;
            const data = await resp.json();
            const deviceIp = document.getElementById('device-ip');
            if (deviceIp && data && data.ip) deviceIp.textContent = data.ip;
        } catch (e) {
            // Silenciar fallos en provisión de IP
        }
    })();

    // Capturador global para lectores de código de barras que envían teclas cuando
    // el input no está visible/enfocado. Solo actúa si el foco NO está en el input.
    window.addEventListener('keydown', (ev) => {
        if (document.activeElement === inputElement) return; // dejar que el formulario maneje

        const k = ev.key;
        // Si es Enter, procesar buffer como código
        if (k === 'Enter') {
            if (__scanBuffer.length > 0) {
                ev.preventDefault();
                const code = __scanBuffer;
                __scanBuffer = '';
                clearTimeout(__scanClearTimer);
                handleScannedCode(code);
            }
            return;
        }

        // Solo acumular caracteres imprimibles (usualmente dígitos en escáner)
        if (k.length === 1) {
            __scanBuffer += k;
            clearTimeout(__scanClearTimer);
            __scanClearTimer = setTimeout(() => { __scanBuffer = ''; }, 120);
        }
    });

    formElement?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const codigo = inputElement.value.trim();
        if (!codigo) return;

        updateUI({ loading: true });

        const producto = await searchProduct(codigo, { 
            byDescription: !isBarcode(codigo) 
        });

        if (producto) {
            updateUI({ loading: false, product: producto });
        }
        
        inputElement.value = '';
    });
});

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

window.addEventListener('resize', () => {
    clearTimeout(window.__fitTimeout);
    window.__fitTimeout = setTimeout(() => fitProductCard(elements), 100);
});

window.addEventListener('orientationchange', () => setTimeout(() => fitProductCard(elements), 200));