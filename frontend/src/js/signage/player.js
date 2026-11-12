/**
 * Reproductor Publicitario Ligero para Raspberry Pi (Modo Kiosco).
 *
 * Optimizaciones clave de hardware:
 * 1. Reutiliza SIEMPRE el mismo nodo <video> y el mismo nodo <img> en el DOM
 *    (evita reinicializar el decodificador por hardware MMAL/V4L2 de la Raspberry Pi).
 * 2. Ejecuta URL.revokeObjectURL() en cada transición para mantener el consumo de RAM plano.
 * 3. Interrupción síncrona en < 2 ms al detectar actividad del escáner o pantalla.
 */

import { getMediaRecord } from './storage-idb.js';

export class SignagePlayer {
    constructor() {
        this.overlayEl = document.getElementById('signage-overlay');
        this.videoEl   = document.getElementById('signage-video');
        this.imageEl   = document.getElementById('signage-image');
        this.bannerEl  = document.getElementById('signage-banner');
        this.bannerTxt = document.getElementById('signage-banner-text');

        this.isPlaying      = false;
        this.items          = [];
        this.currentIndex   = 0;
        this.audioEnabled   = false;
        this.currentBlobUrl = null;
        this.slideTimer     = null;
        this.watchdogTimer  = null;
        this.playSessionId  = 0; // Evita condiciones de carrera si se interrumpe mientras lee IndexedDB

        this._bindMediaEvents();
    }

    _bindMediaEvents() {
        if (!this.videoEl) return;

        // Cuando un video termina, avanzar al siguiente elemento de la lista
        this.videoEl.addEventListener('ended', () => {
            if (!this.isPlaying) return;
            this._nextSlide();
        });

        // Si un video falla al decodificar en la Raspberry Pi, saltar al siguiente sin congelar la pantalla
        this.videoEl.addEventListener('error', () => {
            if (!this.isPlaying) return;
            console.warn('[SignagePlayer] Error decodificando video, saltando al siguiente elemento.');
            this._nextSlide();
        });
    }

    /**
     * Configura los parámetros de la playlist activa y del dispositivo.
     * @param {Object} manifest
     */
    configure(manifest) {
        if (!manifest || !manifest.playlist) {
            this.items = [];
            return;
        }

        const { device, playlist } = manifest;
        this.audioEnabled = Boolean(device?.audio_enabled);
        this.items = Array.isArray(playlist.items)
            ? [...playlist.items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            : [];

        // Configurar cintillo informativo inferior
        if (this.bannerEl && this.bannerTxt) {
            const showBanner = playlist.show_banner !== false;
            const text = playlist.banner_text || 'Pase su producto por el lector o toque la pantalla para consultar el precio';
            this.bannerTxt.textContent = text;
            this.bannerEl.classList.toggle('signage-hidden', !showBanner);
        }
    }

    /**
     * Indica si hay al menos un elemento configurado para reproducir.
     */
    hasContent() {
        return this.items.length > 0;
    }

    /**
     * Inicia el bucle de reproducción en pantalla completa.
     * @returns {Promise<boolean>} true si logró iniciar reproducción.
     */
    async start() {
        if (this.isPlaying || !this.overlayEl || this.items.length === 0) {
            return false;
        }

        this.isPlaying = true;
        this.playSessionId++;
        const sessionId = this.playSessionId;

        this.overlayEl.classList.remove('signage-hidden');
        this.overlayEl.setAttribute('aria-hidden', 'false');

        await this._playSlideAt(this.currentIndex, sessionId);
        return this.isPlaying;
    }

    /**
     * INTERRUPCIÓN INSTANTÁNEA (< 2 ms).
     * Se ejecuta de forma 100% síncrona en cuanto llega el 1er dígito del escáner o un toque.
     */
    stopImmediately() {
        if (!this.isPlaying && this.overlayEl?.classList.contains('signage-hidden')) {
            return;
        }

        this.isPlaying = false;
        this.playSessionId++; // Invalida cualquier lectura pendiente de IndexedDB

        // 1. Ocultar capa visual inmediatamente en el mismo frame
        if (this.overlayEl) {
            this.overlayEl.classList.add('signage-hidden');
            this.overlayEl.setAttribute('aria-hidden', 'true');
        }

        // 2. Pausar decodificador de video de inmediato
        if (this.videoEl && !this.videoEl.paused) {
            try {
                this.videoEl.pause();
            } catch (_) {}
        }

        // 3. Limpiar temporizadores de imágenes y watchdog
        this._clearTimers();

        // 4. Liberar el Blob URL de la memoria RAM en el siguiente microtask
        //    para no restar ni un microsegundo al hilo del escáner de código de barras.
        const urlToRevoke = this.currentBlobUrl;
        this.currentBlobUrl = null;
        if (urlToRevoke) {
            setTimeout(() => {
                try {
                    if (this.videoEl) this.videoEl.removeAttribute('src');
                    if (this.imageEl) this.imageEl.removeAttribute('src');
                    URL.revokeObjectURL(urlToRevoke);
                } catch (_) {}
            }, 0);
        }
    }

    _clearTimers() {
        if (this.slideTimer) {
            clearTimeout(this.slideTimer);
            this.slideTimer = null;
        }
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    _revokeCurrentBlobUrl() {
        if (this.currentBlobUrl) {
            try {
                URL.revokeObjectURL(this.currentBlobUrl);
            } catch (_) {}
            this.currentBlobUrl = null;
        }
    }

    _nextSlide() {
        if (!this.isPlaying || this.items.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this._playSlideAt(this.currentIndex, this.playSessionId);
    }

    async _playSlideAt(index, sessionId, failedAttempts = 0) {
        if (!this.isPlaying || sessionId !== this.playSessionId) return;

        // Si ningún archivo de la lista está disponible aún en IndexedDB, salir limpiamente
        if (failedAttempts >= this.items.length) {
            this.stopImmediately();
            return;
        }

        this._clearTimers();
        const item = this.items[index];
        if (!item) {
            this.stopImmediately();
            return;
        }

        let record = null;
        try {
            record = await getMediaRecord(item.checksum_sha256);
        } catch (err) {
            console.warn('[SignagePlayer] Error leyendo IndexedDB:', err);
        }

        // Verificar que no nos hayan interrumpido mientras esperábamos a IndexedDB
        if (!this.isPlaying || sessionId !== this.playSessionId) return;

        // Si el Blob aún no se ha descargado, pasar al siguiente elemento disponible
        if (!record || !record.blob) {
            this.currentIndex = (index + 1) % this.items.length;
            return this._playSlideAt(this.currentIndex, sessionId, failedAttempts + 1);
        }

        // Liberar el Blob URL del anuncio anterior antes de crear el nuevo
        this._revokeCurrentBlobUrl();
        const blobUrl = URL.createObjectURL(record.blob);
        this.currentBlobUrl = blobUrl;

        const isVideo = item.media_type === 'video' || (record.mime_type && record.mime_type.startsWith('video/'));

        if (isVideo && this.videoEl) {
            // Ocultar nodo de imagen y mostrar nodo de video
            this.imageEl?.classList.add('signage-hidden');
            this.videoEl.classList.remove('signage-hidden');

            this.videoEl.src = blobUrl;
            this.videoEl.muted = !this.audioEnabled;

            // Watchdog de seguridad (máximo 5 minutos por video por si se congela el stream)
            const maxDurationMs = ((item.duration_sec && item.duration_sec > 0) ? item.duration_sec + 5 : 300) * 1000;
            this.watchdogTimer = setTimeout(() => this._nextSlide(), maxDurationMs);

            try {
                await this.videoEl.play();
            } catch (playErr) {
                // Si falla por política de autoplay con audio activo, reintentar silenciado (muted)
                if (!this.videoEl.muted && this.isPlaying) {
                    this.videoEl.muted = true;
                    try {
                        await this.videoEl.play();
                    } catch (_) {
                        this._nextSlide();
                    }
                } else {
                    this._nextSlide();
                }
            }
        } else if (this.imageEl) {
            // Pausar video si estaba activo y mostrar imagen
            if (this.videoEl && !this.videoEl.paused) {
                try { this.videoEl.pause(); } catch (_) {}
            }
            this.videoEl?.classList.add('signage-hidden');
            this.imageEl.classList.remove('signage-hidden');

            this.imageEl.src = blobUrl;
            const durationMs = Math.max(Number(item.duration_sec) || 8, 3) * 1000;
            this.slideTimer = setTimeout(() => this._nextSlide(), durationMs);
        }
    }
}

