export default class PriceAPI {
    constructor({ baseUrl = '', enableMock = false } = {}) {
        this.baseUrl = baseUrl.replace(/\/+$/,'');
        this.enableMock = enableMock;
        this.currentController = null;
    }

    abort() {
        if (this.currentController) {
            try { this.currentController.abort(); } catch(e) {}
            this.currentController = null;
        }
    }

    async _fetch(path) {
        this.abort();
        this.currentController = new AbortController();
        const url = `${this.baseUrl}${path}`;
        const resp = await fetch(url, { signal: this.currentController.signal });
        if (!resp.ok) {
            const err = new Error(`HTTP ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    }

    async searchByCode(code) {
        try {
            const data = await this._fetch(`/buscar_producto/${encodeURIComponent(code)}`);
            return data;
        } catch (err) {
            if (err.name === 'AbortError') return null;
            if (this.enableMock) return this._mock(code);
            throw err;
        }
    }

    async searchByDescription(q) {
        try {
            const data = await this._fetch(`/search-voice?q=${encodeURIComponent(q)}`);
            return Array.isArray(data) ? data[0] : data;
        } catch (err) {
            if (err.name === 'AbortError') return null;
            if (this.enableMock) return this._mock(q);
            throw err;
        }
    }

    _mock(q) {
        return Promise.resolve({
            id: `DEMO-${Math.floor(Math.random()*1000)}`,
            nombre: `PRODUCTO DE PRUEBA: ${q.toUpperCase()}`,
            precio_final_local: 450.50,
            precio_en_dolares: 12.50,
            disponible: true,
            porcentaje_descuento: 10,
            promocion: true,
            precio_base: 500.00,
            precio_base_aplicado: 450.50,
            iva_porcentaje: 16
        });
    }
}
