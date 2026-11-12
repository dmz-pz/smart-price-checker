/**
 * Cliente de Sincronización Silenciosa (Offline-First) hacia el Proyecto 2 (Digital Signage CMS).
 *
 * Funciones:
 * 1. Carga inmediatamente el último manifiesto guardado en IndexedDB (arranque 0-red).
 * 2. Si aún no existe manifiesto en IndexedDB y el servidor CMS externo (puerto 5030)
 *    no está encendido todavía, inicializa una Playlist Demo Local en IndexedDB usando
 *    los recursos locales de `assets/img/` para permitir pruebas reales en la Raspberry Pi.
 * 3. Sincroniza en segundo plano contra `GET /api/v1/signage/manifest` y escucha eventos
 *    SSE en `GET /api/v1/signage/stream` con escalonamiento (jitter) para no saturar el Wi-Fi.
 */

import {
    getStoredManifest,
    saveStoredManifest,
    hasMediaBlob,
    saveMediaBlob,
    pruneUnusedMedia
} from './storage-idb.js';

const DEFAULT_SIGNAGE_API = 'http://192.168.15.102:5030/api/v1/signage';

/**
 * Genera el manifiesto de demostración local (para validar Fase 1 sin depender del Proyecto 2).
 * @param {number} defaultTimeoutSec
 */
function buildLocalDemoManifest(defaultTimeoutSec = 30) {
    return {
        device: {
            id: 0,
            device_code: 'DEMO-LOCAL-PI',
            name: 'Verificador (Modo Demo Local IndexedDB)',
            ip_address: '127.0.0.1',
            audio_enabled: false
        },
        playlist: {
            id: 1,
            name: 'Playlist Demo Local (IndexedDB)',
            version: 1,
            inactivity_timeout_sec: defaultTimeoutSec,
            show_banner: true,
            banner_text: 'Pase su producto por el lector o toque la pantalla para consultar el precio',
            items: [
                {
                    sort_order: 1,
                    media_id: 101,
                    title: 'Promoción Destacada 1',
                    media_type: 'image',
                    mime_type: 'image/webp',
                    checksum_sha256: 'demo-local-asset-1-webp',
                    duration_sec: 7,
                    download_url: 'assets/img/1.webp'
                },
                {
                    sort_order: 2,
                    media_id: 102,
                    title: 'Promoción Destacada 2',
                    media_type: 'image',
                    mime_type: 'image/webp',
                    checksum_sha256: 'demo-local-asset-2-webp',
                    duration_sec: 7,
                    download_url: 'assets/img/2.webp'
                },
                {
                    sort_order: 3,
                    media_id: 103,
                    title: 'Promoción Destacada 3',
                    media_type: 'image',
                    mime_type: 'image/webp',
                    checksum_sha256: 'demo-local-asset-3-webp',
                    duration_sec: 7,
                    download_url: 'assets/img/3.webp'
                }
            ]
        }
    };
}

export class SignageSyncClient {
    /**
     * @param {Object} options
     * @param {string} [options.signageApiUrl] URL base del servidor CMS (Proyecto 2)
     * @param {number} [options.defaultTimeoutSec] Segundos de inactividad por defecto (30s)
     * @param {Function} [options.onManifestReady] Callback cuando hay una playlist lista en IndexedDB
     */
    constructor({ signageApiUrl, defaultTimeoutSec = 30, onManifestReady } = {}) {
        this.signageApiUrl     = signageApiUrl || localStorage.getItem('SIGNAGE_API_URL') || DEFAULT_SIGNAGE_API;
        this.defaultTimeoutSec = defaultTimeoutSec;
        this.onManifestReady   = onManifestReady;
        this.deviceIp          = '127.0.0.1';
        this.deviceCode        = this._resolveDeviceCode();
        this.eventSource       = null;
        this.isSyncing         = false;
        this.statusDotEl       = document.getElementById('signage-sync-dot');
    }

    _resolveDeviceCode() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get('device') || params.get('device_code');
        if (fromUrl) {
            localStorage.setItem('VERIFICADOR_DEVICE_CODE', fromUrl);
            return fromUrl;
        }
        return localStorage.getItem('VERIFICADOR_DEVICE_CODE') || '';
    }

    _setSyncIndicator(state, title = '') {
        if (!this.statusDotEl) return;
        this.statusDotEl.title = title;
        this.statusDotEl.dataset.syncState = state; // 'synced' | 'syncing' | 'local' | 'error'
    }

    /**
     * Inicializa el motor Offline-First:
     * 1. Carga inmediatamente lo que exista en IndexedDB.
     * 2. Intenta sincronizar en segundo plano con el Proyecto 2 o prepara el Demo Local en IndexedDB.
     * @param {string} [detectedIp]
     */
    async init(detectedIp) {
        if (detectedIp) this.deviceIp = detectedIp;

        // Paso 1: Arranque instantáneo desde IndexedDB si ya existe manifiesto previo
        try {
            const cachedManifest = await getStoredManifest();
            if (cachedManifest?.playlist?.items?.length) {
                this._setSyncIndicator('local', `Playlist en caché local (${cachedManifest.playlist.name})`);
                this.onManifestReady?.(cachedManifest);
            }
        } catch (err) {
            console.warn('[SignageSync] No se pudo leer manifiesto previo de IndexedDB:', err);
        }

        // Paso 2: Intentar sincronizar con el Servidor CMS (Proyecto 2) en segundo plano
        const remoteSuccess = await this.syncFromRemoteServer();

        // Paso 3: Si el servidor CMS aún no está activo y no teníamos nada en IndexedDB,
        // hidratar IndexedDB con la Playlist Demo Local para que el verificador sea 100% funcional
        if (!remoteSuccess) {
            const currentManifest = await getStoredManifest();
            if (!currentManifest?.playlist?.items?.length) {
                await this._bootstrapLocalDemoInIndexedDB();
            }
        } else {
            // Si el servidor CMS respondió, conectar canal de eventos en tiempo real (SSE)
            this._connectSSE();
        }
    }

    /**
     * Descarga y guarda en IndexedDB la Playlist Demo Local.
     */
    async _bootstrapLocalDemoInIndexedDB() {
        try {
            this._setSyncIndicator('syncing', 'Preparando Playlist Demo en IndexedDB...');
            const demoManifest = buildLocalDemoManifest(this.defaultTimeoutSec);
            await this._downloadAndStoreItems(demoManifest);
            await saveStoredManifest(demoManifest);
            this._setSyncIndicator('local', 'Modo Demo Offline-First activo (IndexedDB)');
            this.onManifestReady?.(demoManifest);
        } catch (err) {
            console.warn('[SignageSync] Error preparando demo local en IndexedDB:', err);
            this._setSyncIndicator('error', 'Sin conexión al servidor de señalización');
        }
    }

    /**
     * Consulta `/manifest` en el Proyecto 2 y descarga en segundo plano solo los Blobs nuevos.
     * @returns {Promise<boolean>} true si el servidor CMS respondió correctamente.
     */
    async syncFromRemoteServer() {
        if (this.isSyncing) return false;
        this.isSyncing = true;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        try {
            const qs = new URLSearchParams({
                ip: this.deviceIp,
                ...(this.deviceCode ? { device_code: this.deviceCode } : {})
            });

            const res = await fetch(`${this.signageApiUrl}/manifest?${qs.toString()}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const remoteManifest = await res.json();

            if (!remoteManifest?.playlist?.items) {
                this.isSyncing = false;
                return true;
            }

            this._setSyncIndicator('syncing', 'Descargando multimedia en segundo plano...');
            await this._reportDeviceStatus('syncing', 10, remoteManifest.playlist.version);

            await this._downloadAndStoreItems(remoteManifest, (progressPct) => {
                this._reportDeviceStatus('syncing', progressPct, remoteManifest.playlist.version);
            });

            // Guardar nuevo manifiesto y purgar videos antiguos de IndexedDB
            await saveStoredManifest(remoteManifest);
            const validChecksums = remoteManifest.playlist.items.map(i => i.checksum_sha256);
            await pruneUnusedMedia(validChecksums);

            await this._reportDeviceStatus('synced', 100, remoteManifest.playlist.version);
            this._setSyncIndicator('synced', `Sincronizado: ${remoteManifest.playlist.name} (v${remoteManifest.playlist.version ?? 1})`);

            this.onManifestReady?.(remoteManifest);
            this.isSyncing = false;
            return true;
        } catch (_) {
            clearTimeout(timeoutId);
            this.isSyncing = false;
            return false;
        }
    }

    /**
     * Descarga secuencialmente los archivos que aún no existan en IndexedDB (por SHA-256).
     */
    async _downloadAndStoreItems(manifest, onProgress) {
        const items = manifest?.playlist?.items || [];
        const total = items.length;
        if (total === 0) return;

        for (let i = 0; i < total; i++) {
            const item = items[i];
            const alreadyStored = await hasMediaBlob(item.checksum_sha256);

            if (!alreadyStored && item.download_url) {
                const resp = await fetch(item.download_url);
                if (resp.ok) {
                    const blob = await resp.blob();
                    await saveMediaBlob(item.checksum_sha256, blob, {
                        media_id: item.media_id,
                        title: item.title,
                        media_type: item.media_type,
                        mime_type: item.mime_type || blob.type
                    });
                }
            }

            if (onProgress) {
                const pct = Math.round(((i + 1) / total) * 100);
                onProgress(pct);
            }
        }
    }

    async _reportDeviceStatus(syncStatus, progress, playlistVersion) {
        try {
            await fetch(`${this.signageApiUrl}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip_address: this.deviceIp,
                    device_code: this.deviceCode,
                    sync_status: syncStatus,
                    sync_progress: progress,
                    playlist_version: playlistVersion
                })
            });
        } catch (_) {
            // Silencioso para no afectar jamás la consola ni el verificador
        }
    }

    /**
     * Conecta al canal Server-Sent Events (SSE) del Proyecto 2 para recibir avisos
     * de actualización de playlist en tiempo real.
     */
    _connectSSE() {
        if (this.eventSource || !window.EventSource) return;

        try {
            const qs = new URLSearchParams({ ip: this.deviceIp });
            this.eventSource = new EventSource(`${this.signageApiUrl}/stream?${qs.toString()}`);

            this.eventSource.addEventListener('sync_playlist', (ev) => {
                let jitterMs = Math.floor(Math.random() * 8000) + 1000;
                try {
                    const payload = JSON.parse(ev.data || '{}');
                    if (typeof payload.delay_ms === 'number') jitterMs = payload.delay_ms;
                } catch (_) {}

                setTimeout(() => {
                    this.syncFromRemoteServer();
                }, jitterMs);
            });

            this.eventSource.addEventListener('force_reload', () => {
                window.location.reload();
            });

            this.eventSource.onerror = () => {
                // Si el servidor CMS se apaga, cerramos el EventSource para evitar reconexiones agresivas en la Pi
                this.eventSource?.close();
                this.eventSource = null;
            };
        } catch (_) {}
    }
}

