/**
 * Controlador de la Pantalla Dedicada Multi-Zona (70% Señalización / 30% Turnos RapidCola).
 *
 * Características:
 * 1. Reutiliza SignagePlayer + SignageSyncClient (IndexedDB Offline-First) en reproducción continua.
 * 2. Soporta modo Departamento Único (?dept=carniceria o ?dept=charcuteria) usando
 *    GET /api/display/{slug} de RapidCola, o modo Multi-Departamento (?dept=all) usando GET /api/display.
 * 3. Permite que el futuro Dashboard Administrativo cambie remotamente tanto la Playlist
 *    como el departamento de turnos asignado (`manifest.device.queue_department`).
 * 4. Incluye simulación interactiva automática (tecla Espacio o clic en la tarjeta) cuando
 *    el servidor de RapidCola no está en línea en el entorno de pruebas.
 */

import { SignagePlayer } from './player.js';
import { SignageSyncClient } from './sync-client.js';
import { formatCurrency } from '../utils/format.js';

const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin)
    ? `${window.location.origin}/api/v1`
    : 'http://localhost:5020/api/v1';

const DEFAULT_SIGNAGE_API = `http://${window.location.hostname || 'localhost'}:5030/api/v1/signage`;
const DEFAULT_RAPIDCOLA_API = `http://${window.location.hostname || 'localhost'}:8000`;

// Metadatos visuales por departamento (colores de alto contraste inspirados en la referencia)
const DEPARTMENT_THEMES = {
    carniceria: {
        slug: 'carniceria',
        name: 'CARNICERÍA',
        prefix: 'C',
        colorClass: 'dept-theme-carniceria',
        icon: 'fa-solid fa-drumstick-bite',
        subtitle: 'Cortes frescos y preparados'
    },
    charcuteria: {
        slug: 'charcuteria',
        name: 'CHARCUTERÍA',
        prefix: 'CH',
        colorClass: 'dept-theme-charcuteria',
        icon: 'fa-solid fa-cheese',
        subtitle: 'Quesos y embutidos selectos'
    },
    pescaderia: {
        slug: 'pescaderia',
        name: 'PESCADERÍA',
        prefix: 'P',
        colorClass: 'dept-theme-pescaderia',
        icon: 'fa-solid fa-fish-fins',
        subtitle: 'Productos frescos del mar'
    },
    fruteria: {
        slug: 'fruteria',
        name: 'FRUTERÍA',
        prefix: 'F',
        colorClass: 'dept-theme-fruteria',
        icon: 'fa-solid fa-apple-whole',
        subtitle: 'Frutas y hortalizas del campo'
    }
};

class TurnosDisplayController {
    constructor() {
        const params = new URLSearchParams(window.location.search);

        this.urlDept = (params.get('dept') || '').toLowerCase().trim();
        this.activeDept = this.urlDept || localStorage.getItem('TURNOS_DEPT') || 'all';

        const rapidParam = params.get('rapidcola');
        if (rapidParam) localStorage.setItem('RAPIDCOLA_API_URL', rapidParam);
        this.rapidColaUrl = (rapidParam || localStorage.getItem('RAPIDCOLA_API_URL') || DEFAULT_RAPIDCOLA_API).replace(/\/+$/, '');

        this.enableTTS = params.get('tts') === '1';
        this.pollIntervalMs = Number(params.get('poll')) || 2000;

        // Estado de turnos para detectar cambios y disparar alerta visual/sonora
        this.lastTicketsBySlug = {};
        this.isRapidColaOnline = false;

        // Estado Demo Local (cuando el servidor RapidCola no está alcanzable en pruebas)
        this.demoState = {
            fruteria:    { slug: 'fruteria',    number: 94, customer_name: 'María Rodríguez', waiting: ['095', '096', '097'] },
            pescaderia:  { slug: 'pescaderia',  number: 52, customer_name: 'Carlos Pérez',    waiting: ['053', '054'] },
            carniceria:  { slug: 'carniceria',  number: 22, customer_name: 'José Gómez',      waiting: ['023', '024', '025'] },
            charcuteria: { slug: 'charcuteria', number: 38, customer_name: 'Ana Martínez',    waiting: ['039', '040'] }
        };

        this.containerEl   = document.getElementById('queue-cards-container');
        this.statusBadgeEl = document.getElementById('rapidcola-status-badge');
        this.subtitleEl    = document.getElementById('turnos-zone-subtitle');
        this.queueHintEl   = document.getElementById('turnos-queue-hint');

        this.player = new SignagePlayer();
        this.syncClient = new SignageSyncClient({
            signageApiUrl: localStorage.getItem('SIGNAGE_API_URL') || DEFAULT_SIGNAGE_API,
            defaultTimeoutSec: 0,
            onManifestReady: (manifest) => this._onSignageManifestReady(manifest)
        });
    }

    async init() {
        this._updateHeaderSubtitle();
        this._bindSimulationShortcuts();

        // 1. Obtener IP y tasa BCV del backend local
        const detectedIp = await this._fetchDeviceIp();
        this._fetchBcvRate();
        setInterval(() => this._fetchBcvRate(), 5 * 60 * 1000);

        // 2. Iniciar reproductor multimedia Offline-First (IndexedDB) de forma continua
        await this.syncClient.init(detectedIp);

        // 3. Iniciar ciclo de consulta de turnos RapidCola
        await this.refreshQueueDisplay();
        setInterval(() => this.refreshQueueDisplay(), this.pollIntervalMs);
    }

    async _fetchDeviceIp() {
        let ip = '127.0.0.1';
        try {
            const resp = await fetch(`${API_BASE_URL}/my_ip`);
            if (resp.ok) {
                const data = await resp.json();
                if (data?.ip) {
                    ip = data.ip;
                    const el = document.getElementById('device-ip');
                    if (el) el.textContent = ip;
                }
            }
        } catch (_) {}
        return ip;
    }

    async _fetchBcvRate() {
        try {
            const resp = await fetch(`${API_BASE_URL}/tasa`);
            if (!resp.ok) return;
            const data = await resp.json();
            const el = document.getElementById('turnos-bcv-value');
            if (el && data?.tasa) {
                el.textContent = `Bs. ${formatCurrency(data.tasa)}`;
            }
        } catch (_) {}
    }

    _onSignageManifestReady(manifest) {
        // Si el Dashboard remoto especifica un departamento para esta pantalla y no fue forzado por URL
        const remoteDept = manifest?.device?.queue_department;
        if (!this.urlDept && remoteDept && remoteDept !== this.activeDept) {
            this.activeDept = remoteDept.toLowerCase();
            this._updateHeaderSubtitle();
            this.refreshQueueDisplay();
        }

        this.player.configure(manifest);
        if (!this.player.isPlaying && this.player.hasContent()) {
            this.player.start();
        }
    }

    _updateHeaderSubtitle() {
        const theme = DEPARTMENT_THEMES[this.activeDept];
        if (theme) {
            if (this.subtitleEl) this.subtitleEl.textContent = `Departamento de ${theme.name} — ${theme.subtitle}`;
            if (this.queueHintEl) this.queueHintEl.textContent = `Mostrador ${theme.name}`;
        } else {
            if (this.subtitleEl) this.subtitleEl.textContent = 'Ofertas y Llamado de Turnos en Vivo';
            if (this.queueHintEl) this.queueHintEl.textContent = 'Atención por Departamentos';
        }
    }

    /**
     * Consulta la API de RapidCola:
     * - Si hay un departamento específico (ej: 'carniceria'), llama a GET /api/display/carniceria
     * - Si es 'all', llama a GET /api/display
     */
    async refreshQueueDisplay() {
        const isSingleDept = this.activeDept && this.activeDept !== 'all';
        const endpoint = isSingleDept
            ? `${this.rapidColaUrl}/api/display/${encodeURIComponent(this.activeDept)}`
            : `${this.rapidColaUrl}/api/display`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1800);

        try {
            const resp = await fetch(endpoint, { signal: controller.signal });
            clearTimeout(timer);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const payload = await resp.json();
            this.isRapidColaOnline = true;
            this._setRapidColaStatus('online', '● RapidCola En Línea');

            const normalizedList = this._normalizeRapidColaResponse(payload, isSingleDept ? this.activeDept : null);
            this._renderDepartments(normalizedList, isSingleDept);
        } catch (_) {
            clearTimeout(timer);
            this.isRapidColaOnline = false;
            this._setRapidColaStatus('demo', '● Modo Demo Local');

            // Renderizar con datos de simulación local
            const demoList = this._getDemoDepartmentsList(isSingleDept ? this.activeDept : null);
            this._renderDepartments(demoList, isSingleDept);
        }
    }

    _setRapidColaStatus(status, text) {
        if (!this.statusBadgeEl) return;
        this.statusBadgeEl.dataset.status = status;
        this.statusBadgeEl.textContent = text;
    }

    /**
     * Normaliza distintas estructuras posibles del JSON de RapidCola (`/api/display` o `/api/display/{slug}`).
     */
    _normalizeRapidColaResponse(payload, fallbackSlug = null) {
        if (!payload) return [];

        // Si el endpoint /api/display devuelve un array o un objeto con clave departments/displays
        let rawItems = [];
        if (Array.isArray(payload)) {
            rawItems = payload;
        } else if (Array.isArray(payload.departments)) {
            rawItems = payload.departments;
        } else if (payload.departments && typeof payload.departments === 'object') {
            // Estructura real de RapidCola GET /api/display: { departments: { carniceria: {...}, charcuteria: {...} } }
            rawItems = Object.entries(payload.departments)
                .map(([k, v]) => (v && typeof v === 'object' ? { slug: k, ...v } : null))
                .filter(Boolean);
        } else if (Array.isArray(payload.displays)) {
            rawItems = payload.displays;
        } else if (fallbackSlug || payload.department || payload.current_serving !== undefined) {
            rawItems = [{ ...(fallbackSlug ? { slug: fallbackSlug } : {}), ...payload }];
        } else if (typeof payload === 'object') {
            // Si es un mapa directo { carniceria: {...}, charcuteria: {...} }
            rawItems = Object.entries(payload).map(([k, v]) => (v && typeof v === 'object' ? { slug: k, ...v } : null)).filter(Boolean);
        }

        return rawItems.map((item) => {
            const deptInfo = (item.department && typeof item.department === 'object') ? item.department : null;
            const slug = String(
                item.slug ||
                deptInfo?.slug ||
                (typeof item.department === 'string' ? item.department : '') ||
                fallbackSlug ||
                'carniceria'
            ).toLowerCase();

            const theme = DEPARTMENT_THEMES[slug] || {
                slug,
                name: String(deptInfo?.name || item.name || slug).toUpperCase(),
                prefix: deptInfo?.prefix || item.prefix || '',
                colorClass: 'dept-theme-carniceria',
                icon: 'fa-solid fa-ticket'
            };

            // Extraer el número de turno actual (RapidCola usa `current_serving.ticket_number`)
            const currentObj = item.current_serving || item.current_ticket || item.current || item.active_ticket || null;
            const rawNum = (currentObj && typeof currentObj === 'object')
                ? (currentObj.ticket_number ?? currentObj.number ?? currentObj.code ?? currentObj.id ?? 0)
                : (currentObj ?? item.current_number ?? item.ticket_number ?? item.number ?? 0);

            const formattedNumber = String(rawNum).padStart(3, '0');
            const customerName = (currentObj && typeof currentObj === 'object' ? currentObj.customer_name : item.customer_name) || '';

            // Extraer próximos turnos en espera (RapidCola usa `next_5_waiting`)
            const rawWaiting = item.next_5_waiting || item.waiting_tickets || item.queue || item.next_tickets || item.waiting || [];
            const waitingList = Array.isArray(rawWaiting)
                ? rawWaiting.slice(0, 4).map(t => String(typeof t === 'object' ? (t.ticket_number ?? t.number ?? t.id) : t).padStart(3, '0'))
                : [];

            const displayName = deptInfo?.name || item.name;
            return {
                slug,
                name: displayName ? String(displayName).toUpperCase() : theme.name,
                colorClass: theme.colorClass,
                icon: theme.icon,
                formattedNumber,
                customerName,
                waitingList
            };
        });
    }

    _getDemoDepartmentsList(singleSlug = null) {
        const slugs = singleSlug && DEPARTMENT_THEMES[singleSlug]
            ? [singleSlug]
            : ['fruteria', 'pescaderia', 'carniceria'];

        return slugs.map((slug) => {
            const theme = DEPARTMENT_THEMES[slug] || DEPARTMENT_THEMES.carniceria;
            const d = this.demoState[slug] || this.demoState.carniceria;
            return {
                slug,
                name: theme.name,
                colorClass: theme.colorClass,
                icon: theme.icon,
                formattedNumber: String(d.number).padStart(3, '0'),
                customerName: d.customer_name || '',
                waitingList: d.waiting || []
            };
        });
    }

    /**
     * Renderiza las tarjetas en la columna derecha (30%) y dispara alerta si cambió algún número.
     */
    _renderDepartments(departments, isSingleDept) {
        if (!this.containerEl) return;

        const changedSlugs = new Set();
        for (const dept of departments) {
            const prev = this.lastTicketsBySlug[dept.slug];
            if (prev !== undefined && prev !== dept.formattedNumber) {
                changedSlugs.add(dept.slug);
            }
            this.lastTicketsBySlug[dept.slug] = dept.formattedNumber;
        }

        if (isSingleDept && departments.length === 1) {
            const d = departments[0];
            const isCalling = changedSlugs.has(d.slug);
            this.containerEl.innerHTML = `
                <article
                    class="turno-dept-card turno-dept-card-single ${d.colorClass} ${isCalling ? 'turno-card-calling' : ''}"
                    data-dept-slug="${d.slug}"
                    title="Clic para simular siguiente turno"
                >
                    <div class="turno-single-header">
                        <div class="turno-icon-circle">
                            <i class="${d.icon}"></i>
                        </div>
                        <h2 class="turno-dept-name-single">${d.name}</h2>
                    </div>

                    <div class="turno-single-number-box">
                        <span class="turno-single-label">TURNO EN ATENCIÓN</span>
                        <div class="turno-number-hero">${d.formattedNumber}</div>
                        ${d.customerName ? `<p class="turno-customer-name"><i class="fa-regular fa-user mr-2"></i>${d.customerName}</p>` : ''}
                    </div>

                    <div class="turno-waiting-box">
                        <span class="turno-waiting-title">PRÓXIMOS TURNOS EN COLA</span>
                        <div class="turno-waiting-pills">
                            ${d.waitingList.length > 0
                                ? d.waitingList.map(num => `<span class="turno-waiting-pill">${num}</span>`).join('')
                                : `<span class="text-sm opacity-75">Sin cola de espera</span>`
                            }
                        </div>
                    </div>
                </article>
            `;
        } else {
            // Vista apilada estilo imagen de referencia (Frutería 094, Pescadería 052, Carnicería 022)
            this.containerEl.innerHTML = departments.map((d) => {
                const isCalling = changedSlugs.has(d.slug);
                return `
                    <article
                        class="turno-dept-card ${d.colorClass} ${isCalling ? 'turno-card-calling' : ''}"
                        data-dept-slug="${d.slug}"
                        title="Clic para simular siguiente turno en ${d.name}"
                    >
                        <div class="turno-card-header">${d.name}</div>
                        <div class="turno-card-body">
                            <div class="turno-icon-circle">
                                <i class="${d.icon}"></i>
                            </div>
                            <div class="turno-number-display">${d.formattedNumber}</div>
                        </div>
                    </article>
                `;
            }).join('');
        }

        // Permitir clic en cualquier tarjeta para simular el avance de turno en modo Demo
        this.containerEl.querySelectorAll('.turno-dept-card').forEach((card) => {
            card.addEventListener('click', () => {
                this.simulateNextTurn(card.dataset.deptSlug);
            });
        });

        // Si algún turno cambió, emitir campanilla sonora ("Ding-Dong")
        if (changedSlugs.size > 0) {
            this._playChimeSound();
            if (this.enableTTS) {
                const firstSlug = [...changedSlugs][0];
                const changedDept = departments.find(d => d.slug === firstSlug);
                if (changedDept) this._speakTurn(changedDept);
            }
        }
    }

    /**
     * Avanza un turno en modo simulación (o envía POST /api/operator/{slug}/next si RapidCola está activo).
     */
    async simulateNextTurn(targetSlug = null) {
        const slug = targetSlug || (this.activeDept !== 'all' ? this.activeDept : 'carniceria');

        if (this.isRapidColaOnline) {
            try {
                await fetch(`${this.rapidColaUrl}/api/operator/${encodeURIComponent(slug)}/next`, {
                    method: 'POST'
                });
                await this.refreshQueueDisplay();
                return;
            } catch (_) {}
        }

        // Modo Demo Local: incrementar turno y rotar cola de espera
        if (!this.demoState[slug]) {
            this.demoState[slug] = { slug, number: 1, customer_name: 'Cliente en Turno', waiting: ['002', '003'] };
        }
        const entry = this.demoState[slug];
        entry.number = (entry.number + 1) % 1000;
        const n = entry.number;
        entry.waiting = [
            String((n + 1) % 1000).padStart(3, '0'),
            String((n + 2) % 1000).padStart(3, '0'),
            String((n + 3) % 1000).padStart(3, '0')
        ];

        const isSingleDept = this.activeDept && this.activeDept !== 'all';
        const demoList = this._getDemoDepartmentsList(isSingleDept ? this.activeDept : null);
        this._renderDepartments(demoList, isSingleDept);
    }

    _bindSimulationShortcuts() {
        window.addEventListener('keydown', (ev) => {
            if (ev.code === 'Space' || ev.key === '+') {
                ev.preventDefault();
                this.simulateNextTurn();
            } else if (ev.key === '1') {
                this.activeDept = 'carniceria';
                this._updateHeaderSubtitle();
                this.refreshQueueDisplay();
            } else if (ev.key === '2') {
                this.activeDept = 'charcuteria';
                this._updateHeaderSubtitle();
                this.refreshQueueDisplay();
            } else if (ev.key === '0') {
                this.activeDept = 'all';
                this._updateHeaderSubtitle();
                this.refreshQueueDisplay();
            }
        });
    }

    /**
     * Genera un tono agradable de campana de turno ("Ding-Dong") usando Web Audio API
     * sin depender de archivos MP3 externos.
     */
    _playChimeSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const now = ctx.currentTime;

            // Nota 1: Mi5 (659.25 Hz) -> Nota 2: Do5 (523.25 Hz)
            const playTone = (freq, startTime, duration) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.001, startTime);
                gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + duration);
            };

            playTone(659.25, now, 0.45);
            playTone(523.25, now + 0.35, 0.65);
        } catch (_) {}
    }

    _speakTurn(dept) {
        try {
            const text = `Turno ${Number(dept.formattedNumber)}, pasar a ${dept.name}`;
            if (this.isRapidColaOnline) {
                const audio = new Audio(`${this.rapidColaUrl}/api/voice/tts?text=${encodeURIComponent(text)}`);
                audio.play().catch(() => {});
            } else if ('speechSynthesis' in window) {
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-ES';
                window.speechSynthesis.speak(utter);
            }
        } catch (_) {}
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const controller = new TurnosDisplayController();
    controller.init();
});
