/**
 * Módulo de Almacenamiento Local Offline-First (IndexedDB)
 * Diseñado para Raspberry Pi en modo Kiosco.
 *
 * Base de datos: VerificadorSignageDB (v1)
 * Object Stores:
 *  - media_store (keyPath: 'checksum_sha256'): Almacena los binarios (Blob) deduplicados por hash.
 *  - config_store (keyPath: 'key'): Almacena el manifiesto activo ('active_manifest').
 */

const DB_NAME = 'VerificadorSignageDB';
const DB_VERSION = 1;
const STORE_MEDIA = 'media_store';
const STORE_CONFIG = 'config_store';

let dbInstance = null;

/**
 * Abre (o reutiliza) la conexión a IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
export function openSignageDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            return reject(new Error('IndexedDB no está soportado en este navegador.'));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_MEDIA)) {
                db.createObjectStore(STORE_MEDIA, { keyPath: 'checksum_sha256' });
            }

            if (!db.objectStoreNames.contains(STORE_CONFIG)) {
                db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;

            dbInstance.onversionchange = () => {
                dbInstance.close();
                dbInstance = null;
            };

            resolve(dbInstance);
        };

        request.onerror = (event) => {
            reject(event.target.error || new Error('Error al abrir IndexedDB'));
        };
    });
}

/**
 * Obtiene el manifiesto de reproducción guardado localmente.
 * Permite arrancar la publicidad sin conexión a la red tras un corte eléctrico.
 * @returns {Promise<Object|null>}
 */
export async function getStoredManifest() {
    const db = await openSignageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CONFIG, 'readonly');
        const store = tx.objectStore(STORE_CONFIG);
        const req = store.get('active_manifest');

        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Guarda el manifiesto de reproducción activo en IndexedDB.
 * @param {Object} manifest
 * @returns {Promise<void>}
 */
export async function saveStoredManifest(manifest) {
    const db = await openSignageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CONFIG, 'readwrite');
        const store = tx.objectStore(STORE_CONFIG);
        store.put({
            key: 'active_manifest',
            value: manifest,
            updated_at: Date.now()
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Verifica si un archivo multimedia (identificado por su SHA-256) ya existe en IndexedDB.
 * Usa getKey() para no cargar el Blob en la memoria RAM de la Raspberry Pi durante la verificación.
 * @param {string} checksum
 * @returns {Promise<boolean>}
 */
export async function hasMediaBlob(checksum) {
    if (!checksum) return false;
    const db = await openSignageDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_MEDIA, 'readonly');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.getKey(checksum);

        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => resolve(false);
    });
}

/**
 * Recupera el registro multimedia (incluyendo el Blob binario) desde IndexedDB.
 * @param {string} checksum
 * @returns {Promise<{checksum_sha256: string, blob: Blob, mime_type: string}|null>}
 */
export async function getMediaRecord(checksum) {
    if (!checksum) return null;
    const db = await openSignageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, 'readonly');
        const store = tx.objectStore(STORE_MEDIA);
        const req = store.get(checksum);

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Almacena un Blob multimedia en IndexedDB indexado por su checksum SHA-256.
 * @param {string} checksum
 * @param {Blob} blob
 * @param {Object} meta
 * @returns {Promise<void>}
 */
export async function saveMediaBlob(checksum, blob, meta = {}) {
    const db = await openSignageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(STORE_MEDIA);

        store.put({
            checksum_sha256: checksum,
            media_id: meta.media_id ?? null,
            title: meta.title ?? '',
            media_type: meta.media_type ?? 'image',
            mime_type: meta.mime_type || blob.type || 'application/octet-stream',
            blob,
            downloaded_at: Date.now()
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Elimina de IndexedDB todos los Blobs cuyos checksums ya no formen parte de la playlist activa.
 * Evita que la tarjeta SD de la Raspberry Pi se llene con el paso de los meses.
 * @param {string[]} activeChecksums
 * @returns {Promise<number>} Cantidad de archivos obsoletos eliminados.
 */
export async function pruneUnusedMedia(activeChecksums = []) {
    const validSet = new Set(activeChecksums);
    const db = await openSignageDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(STORE_MEDIA);
        const keysReq = store.getAllKeys();
        let removedCount = 0;

        keysReq.onsuccess = () => {
            const allKeys = keysReq.result || [];
            for (const key of allKeys) {
                if (!validSet.has(key)) {
                    store.delete(key);
                    removedCount++;
                }
            }
        };

        tx.oncomplete = () => resolve(removedCount);
        tx.onerror = () => reject(tx.error);
    });
}

