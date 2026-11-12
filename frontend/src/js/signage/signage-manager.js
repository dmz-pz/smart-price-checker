/**
 * Orquestador del Modo Reposo Publicitario (SignageManager).
 *
 * Responsabilidades:
 * 1. Controlar el temporizador de inactividad (por defecto 30s, o ?idle=N en la URL para pruebas rápidas).
 * 2. Pausar animaciones CSS de fondo mientras se reproduce publicidad para ahorrar GPU en la Raspberry Pi.
 * 3. Proveer el método síncrono `interrupt()` (< 2 ms) que desmonta la publicidad al instante
 *    ante el primer dígito del escáner, toque táctil o activación de búsqueda por voz.
 */

import { SignagePlayer } from './player.js';
import { SignageSyncClient } from './sync-client.js';

export class SignageManager {
    /**
     * @param {Object} options
     * @param {string} [options.signageApiUrl]
     * @param {Function} [options.canStartCallback] Retorna true solo cuando el verificador está en vista inicial limpia
     * @param {Function} [options.onExitSignage] Se invoca de forma síncrona cuando se interrumpe la publicidad
     */
    constructor({ signageApiUrl, canStartCallback, onExitSignage } = {}) {
        this.canStartCallback = canStartCallback || (() => true);
        this.onExitSignage    = onExitSignage;

        // Permitir sobrescribir el tiempo de inactividad por URL (?idle=10) para facilitar pruebas en tienda
        const urlIdleSec = Number(new URLSearchParams(window.location.search).get('idle'));
        this.overrideIdleSec = (urlIdleSec > 0) ? urlIdleSec : null;
        this.inactivityTimeoutMs = (this.overrideIdleSec || 30) * 1000;

        this.inactivityTimer = null;
        this.isIdleAllowed   = true;

        this.player = new SignagePlayer();
        this.syncClient = new SignageSyncClient({
            signageApiUrl,
            defaultTimeoutSec: this.overrideIdleSec || 30,
            onManifestReady: (manifest) => this._handleManifestUpdate(manifest)
        });

        this._bindOverlayTouchEvents();
    }

    /**
     * Si el cliente toca cualquier parte de la pantalla o el cintillo mientras hay publicidad,
     * salimos instantáneamente a la vista de consulta.
     */
    _bindOverlayTouchEvents() {
        const overlay = document.getElementById('signage-overlay');
        if (!overlay) return;

        const handleTouchOrClick = (ev) => {
            if (!this.isActive()) return;
            ev.stopPropagation();
            this.interrupt();
        };

        overlay.addEventListener('pointerdown', handleTouchOrClick, { passive: true });
        overlay.addEventListener('touchstart', handleTouchOrClick, { passive: true });
    }

    /**
     * Inicializa el gestor de señalización una vez que se conoce la IP del verificador.
     * @param {string} [deviceIp]
     */
    async init(deviceIp) {
        await this.syncClient.init(deviceIp);
        this.resetInactivityTimer();
    }

    _handleManifestUpdate(manifest) {
        if (!this.overrideIdleSec && manifest?.playlist?.inactivity_timeout_sec > 0) {
            this.inactivityTimeoutMs = manifest.playlist.inactivity_timeout_sec * 1000;
        }
        this.player.configure(manifest);

        // Si no estamos reproduciendo y el kiosco está en reposo, reiniciar el conteo
        if (!this.isActive() && this.isIdleAllowed) {
            this.resetInactivityTimer();
        }
    }

    /**
     * Indica si la publicidad está ocupando la pantalla en este preciso instante.
     * @returns {boolean}
     */
    isActive() {
        return this.player.isPlaying;
    }

    /**
     * Informa al gestor si la UI del verificador está ocupada (mostrando un producto,
     * cargando, en Bento Grid o escuchando por micrófono) o libre en la pantalla inicial.
     * @param {boolean} isBusy
     */
    setUIBusy(isBusy) {
        this.isIdleAllowed = !isBusy;
        if (isBusy) {
            this._clearInactivityTimer();
            if (this.isActive()) {
                this.interrupt({ skipCallback: true });
            }
        } else {
            this.resetInactivityTimer();
        }
    }

    /**
     * Reinicia la cuenta regresiva de inactividad (ej. 30 segundos).
     */
    resetInactivityTimer() {
        this._clearInactivityTimer();
        if (!this.isIdleAllowed || this.isActive()) return;

        this.inactivityTimer = setTimeout(() => {
            this._tryEnterSignageMode();
        }, this.inactivityTimeoutMs);
    }

    _clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    async _tryEnterSignageMode() {
        this._clearInactivityTimer();

        // No activar publicidad si el micrófono está escuchando o si hay resultados en pantalla
        const voiceBtn = document.getElementById('voice-search-btn');
        const isListeningVoice = voiceBtn?.classList.contains('listening');
        if (!this.isIdleAllowed || isListeningVoice || !this.canStartCallback() || !this.player.hasContent()) {
            this.resetInactivityTimer();
            return;
        }

        // Pausar animaciones CSS de la capa inferior para liberar GPU en la Raspberry Pi
        document.body.classList.add('signage-mode-active');

        const started = await this.player.start();
        if (!started) {
            document.body.classList.remove('signage-mode-active');
            this.resetInactivityTimer();
        }
    }

    /**
     * INTERRUPCIÓN INSTANTÁNEA (< 2 ms).
     * Se invoca en el primer evento `keydown` del escáner de código de barras o toque en pantalla.
     * @param {Object} [options]
     * @param {boolean} [options.skipCallback=false]
     */
    interrupt({ skipCallback = false } = {}) {
        const wasPlaying = this.isActive();
        this._clearInactivityTimer();

        if (wasPlaying) {
            this.player.stopImmediately();
            document.body.classList.remove('signage-mode-active');
            if (!skipCallback && this.onExitSignage) {
                this.onExitSignage();
            }
        }

        if (this.isIdleAllowed) {
            this.resetInactivityTimer();
        }
    }
}

