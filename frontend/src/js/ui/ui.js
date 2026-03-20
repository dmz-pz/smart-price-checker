export function getElements() {
    return {
        input: document.getElementById('barcode-input'),
        status: document.getElementById('status-message'),
        result: document.getElementById('result-display'),
        form: document.getElementById('search-form'),
        header: document.querySelector('header'),
        searchButton: document.getElementById('search-button')
    };
}

export function renderLoading(elements, keep = false) {
    if (!elements) return;
    elements.status.innerHTML = keep ? '' : `<div class="text-4xl text-yellow-400 animate-pulse mt-8">Cargando...</div>`;
    elements.input.disabled = true;
    if (elements.searchButton) elements.searchButton.disabled = true;
}

export function renderError(elements, message) {
    if (!elements) return;
    elements.status.innerHTML = `\n        <div class="text-3xl text-red-500 font-bold p-6 bg-red-100 rounded-xl shadow-lg mt-8">\n            ${message}\n        </div>\n    `;
    if (elements.searchButton) elements.searchButton.disabled = false;
    if (elements.input) elements.input.disabled = false;
}

export function renderInitialLogo(elements, logoPath = 'assets/img/logo_minegocio.png') {
    if (!elements || !elements.result) return;
    elements.result.innerHTML = 
    `\n
    <div class="mt-4 md:mt-10 flex justify-center items-center p-4">\n            
        <img src="${logoPath}" alt="Logo" class="logo-rotatorio w-[60%] sm:w-[40%] max-w-75 object-contain drop-shadow-xl"/>\n        
    </div>
    \n    `;
}

import { formatCurrency } from '../utils/format.js';
import { launchConfetti } from '../utils/confetti.js';

export function displayProduct(elements, product) {
    if (!elements || !elements.result) return;
    const resultElement = elements.result;
    const headerElement = elements.header;

    const isAvailable = product.disponible !== false;
    const porcentaje = Number(product?.porcentaje_descuento ?? 0);
    const isOnPromotion = Boolean(product && product.promocion) && porcentaje > 0;

    resultElement.innerHTML = `
        <div class="product-card fade-in">
            <div class="card-inner">
                <div class="mt-4 w-full p-6  glass-card">
                    <div class="flex justify-between items-center mb-6 border-b border-white pb-4">
                        <p class="text-base text-yellow-400 uppercase font-semibold">Producto</p>
                        <p class="text-base text-yellow-400 font-mono">${product.id ?? product.codigo_barras ?? ''}</p>
                    </div>
                    
                    <h1 class="text-2xl font-bold text-gray-100 mb-6 descripcion-producto">${product.nombre}</h1>
                    
                    <div class="price-container py-2 flex flex-col justify-center items-center">
                        ${!isAvailable
                            ? `<div class="text-6xl font-bold text-red-500">❌ AGOTADO</div>`
                            : `
                                ${porcentaje > 0 && (product.precio_final_sin_descuento || product.precio_base) ? `
                                    <div class="flex flex-col items-center gap-3">
                                        <div class="text-3xl text-gray-300 line-through opacity-80">Bs. ${formatCurrency(product.precio_final_sin_descuento ?? (product.precio_base && product.iva_porcentaje ? (product.precio_base * (1 + product.iva_porcentaje/100)) : product.precio_final_local))}</div>
                                        <div class="text-9xl  font-bold text-yellow-400 tracking-tighter">Bs. ${formatCurrency(product.precio_final_local)}</div>
                                        <div class="text-sm text-gray-200">Precio con descuento aplicado</div>
                                    </div>
                                    <div class="text-3xl mt-6 font-bold border-2 rounded-full gap-x-2 px-6 py-2 ">
                                        <svg xmlns="http://www.w3.org/2000/svg" height="30" width="30" viewBox="0 0 640 512" style="display:inline-block;vertical-align:middle;"><path fill="rgb(251, 251, 251)" d="M24-16C10.7-16 0-5.3 0 8S10.7 32 24 32l45.3 0c3.9 0 7.2 2.8 7.9 6.6l52.1 286.3c6.2 34.2 36 59.1 70.8 59.1L456 384c13.3 0 24-10.7 24-24s-10.7-24-24-24l-255.9 0c-11.6 0-21.5-8.3-23.6-19.7l-5.1-28.3 303.6 0c30.8 0 57.2-21.9 62.9-52.2L568.9 69.9C572.6 50.2 557.5 32 537.4 32l-412.7 0-.4-2c-4.8-26.6-28-46-55.1-46L24-16zM208 512a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm224 0a48 48 0 1 0 0-96 48 48 0 1 0 0 96z"/></svg>
                                        Ref. USD ${formatCurrency(product.precio_en_dolares)}
                                    </div>
                                ` : `
                                    <div class="text-9xl  font-bold text-yellow-400 tracking-tighter">Bs. ${formatCurrency(product.precio_final_local ?? product.precio)}</div>
                                    <div class="text-3xl mt-6 font-bold border-2 rounded-full gap-x-2 px-6 py-2 ">
                                        <svg xmlns="http://www.w3.org/2000/svg" height="30" width="30" viewBox="0 0 640 512" style="display:inline-block;vertical-align:middle;"><path fill="rgb(251, 251, 251)" d="M24-16C10.7-16 0-5.3 0 8S10.7 32 24 32l45.3 0c3.9 0 7.2 2.8 7.9 6.6l52.1 286.3c6.2 34.2 36 59.1 70.8 59.1L456 384c13.3 0 24-10.7 24-24s-10.7-24-24-24l-255.9 0c-11.6 0-21.5-8.3-23.6-19.7l-5.1-28.3 303.6 0c30.8 0 57.2-21.9 62.9-52.2L568.9 69.9C572.6 50.2 557.5 32 537.4 32l-412.7 0-.4-2c-4.8-26.6-28-46-55.1-46L24-16zM208 512a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm224 0a48 48 0 1 0 0-96 48 48 0 1 0 0 96z"/></svg>
                                        Ref. USD ${formatCurrency(product.precio_en_dolares)}
                                    </div>
                                `}
                                <div class=" md:mt-5 flex justify-center items-center"
                                    style="min-height: 120px; width: 100%;"
                                    >
                                    <img src="assets/img/logo_minegocio.png" 
                                    alt="Logo" 
                                    class="logo-rotatorio w-[60%] sm:w-[40%] max-w-75 object-contain drop-shadow-xl"
                                    style="width: clamp(80px, 30%, 180px); height: auto;"
                                    />
                                </div>
                            `
                        }
                    </div>

                    <div class="flex justify-around gap-4 text-lg mb-8">
                        <span class="border-l-2 border-lime-100 text-gray-100 px-4 py-2 ">
                            Base: Bs. ${formatCurrency(product.precio_base)}
                        </span>
                        <span class="border-l-2 border-lime-100 text-gray-100 px-4 py-2 ">
                            IVA (${product.iva_porcentaje ?? '0'}%): Bs. ${formatCurrency(product.iva_monto ?? (product.precio_final_local - (product.precio_base_aplicado ?? product.precio_base) ))}
                        </span>
                    </div>
                    
                    ${isOnPromotion ? `
                    <div class="p-6 rounded-xl font-bold text-3xl text-center bg-yellow-500 text-gray-900 shadow-lg animate-pulse">
                        🎉 PROMOCIÓN: ${porcentaje}% DESC.
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // card.addEventListener('animationend', () => {
            // fitProductCard(elements);
            // }, { once: true }); // { once: true } elimina el listener automáticamente
    if (isOnPromotion) launchConfetti();
    const card = elements.result.querySelector('.product-card');

    // Forzar reanimación aunque el elemento ya existiera
    if (card) {
        card.classList.remove('fade-in');
        void card.offsetWidth; // fuerza reflow del navegador
        card.classList.add('fade-in');
    }
}

export function fitProductCard(elements) {
    if (!elements || !elements.result) return;
    const resultElement = elements.result;
    const headerElement = elements.header;

    const card = resultElement.querySelector('.product-card');
    const inner = resultElement.querySelector('.card-inner');
    if (!card || !inner) return;

    const headerH = headerElement?.offsetHeight || 0;
    const footerH = document.querySelector('footer')?.offsetHeight || 0;
    const availH = window.innerHeight - headerH - footerH - 40;
    const availW = window.innerWidth - 40;

    const glass = resultElement.querySelector('.glass-card');
    if (!glass) return;

    glass.style.transform = '';
    const { scrollHeight: cH, scrollWidth: cW } = inner;

    const scale = Math.min(availH / cH, availW / cW, 1);
    if (scale < 1) {
        glass.style.transform = `scale(${Math.max(scale, 0.75)})`;
        glass.style.transformOrigin = 'top center';
    } else {
        glass.style.transform = '';
    }
}

// ── ui.js — función renderBentoGrid ──────────────────────────────────────────
//
// Esta función recibe los resultados de /search-voice, que en este punto solo
// contienen: { id, nombre, confidence }
//
// NO intenta mostrar precios ni disponibilidad porque esos datos no existen aún.
// Cuando el usuario seleccione una tarjeta, price-checker.js llamará a
// /buscar_producto/<id> y mostrará toda esa información con displayProduct().
//
export function renderBentoGrid(elements, resultados, onSelect) {
    if (!elements?.result) return;
 
    const n = resultados.length;
 
    // Asigna el color del badge según el porcentaje de coincidencia:
    //   verde  → 80% o más  (alta confianza, casi seguro es lo que busca)
    //   amarillo → 60-79%   (coincidencia media, puede ser)
    //   rojo   → menos de 60% (coincidencia baja, se muestra pero con advertencia)
    function badgeStyle(confidence) {
        if (confidence >= 80) return 'background:rgba(163,230,53,0.15); color:#a3e635;';
        if (confidence >= 60) return 'background:rgba(251,191,36,0.15); color:#fbbf24;';
        return 'background:rgba(239,68,68,0.15); color:#f87171;';
    }
 
    // El primer resultado (mayor confianza) ocupa todo el ancho cuando hay 3 o más,
    // para destacarlo visualmente como la mejor opción.
    function cardStyle(i) {
        return (i === 0 && n >= 3) ? 'grid-column: span 2;' : '';
    }
 
    elements.result.innerHTML = `
        <div style="padding: 1rem 0;">
 
            <p class="text-2xl text-white mb-3">
                ${n} resultado${n !== 1 ? 's' : ''} para tu búsqueda — selecciona un producto
            </p>
 
            <div style="
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            ">
                ${resultados.map((p, i) => `
                    <div
                        class="bento-card glass-card cursor-pointer
                               transition-all hover:scale-[1.02] active:scale-[0.98]"
                        data-idx="${i}"
                        style="${cardStyle(i)} padding: 1rem; border-radius: 12px;"
                    >
                        <!-- Nombre del producto -->
                        <p class="text-gray-100 font-semibold text-sm leading-snug"
                           style="margin: 0 0 10px;">
                            ${p.nombre}
                        </p>
 
                        <!-- Código de barras — fuente monoespaciada para legibilidad -->
                        <p class="font-mono text-xs text-gray-400"
                           style="margin: 0 0 10px; letter-spacing: 0.05em;">
                            ${p.id ?? p.codigo_barras ?? '—'}
                        </p>
 
                        <!-- Badge de coincidencia -->
                        <span style="
                            display: inline-block;
                            font-size: 11px;
                            font-weight: 600;
                            padding: 2px 8px;
                            border-radius: 9999px;
                            ${badgeStyle(p.confidence)}
                        ">
                            ${p.confidence}% coincidencia
                        </span>
 
                        <!-- Barra visual de confianza -->
                        <div style="
                            height: 3px;
                            border-radius: 2px;
                            background: rgba(255,255,255,0.08);
                            margin-top: 10px;
                        ">
                            <div style="
                                height: 100%;
                                border-radius: 2px;
                                background: #378ADD;
                                width: ${p.confidence}%;
                                transition: width 0.4s ease;
                            "></div>
                        </div>
                    </div>
                `).join('')}
            </div>
 
        </div>
    `;
 
    // Registrar el listener de selección en cada tarjeta.
    // Al hacer clic, extrae el índice del array original y llama a onSelect()
    // con el objeto completo del resultado, que price-checker.js usará para
    // hacer la petición individual a /buscar_producto/<id>.
    elements.result.querySelectorAll('.bento-card').forEach(card => {
        card.addEventListener('click', () => {
            onSelect(resultados[parseInt(card.dataset.idx)]);
        });
    });
}
 