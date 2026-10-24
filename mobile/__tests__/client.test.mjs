// Pruebas del cliente de la API con fetch simulado (no requieren red).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, verificarConexion, setToken, ApiError } from '../src/api/client.js';

const respuesta = (cuerpo, estado = 200) => ({
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
});

describe('Cliente de la API móvil', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; setToken(null); });
    afterEach(() => { globalThis.fetch = fetchOriginal; });

    it('verificarConexion llama a /api/health y devuelve el mensaje', async () => {
        globalThis.fetch = async (url, opciones) => { llamadas.push({ url, opciones }); return respuesta({ message: 'Activa' }); };
        const r = await verificarConexion();
        assert.equal(r.mensaje, 'Activa');
        assert.match(llamadas[0].url, /\/api\/health$/);
        assert.ok(r.demoraMs >= 0);
    });

    it('envía el token JWT solo cuando hay sesión', async () => {
        globalThis.fetch = async (url, opciones) => { llamadas.push(opciones); return respuesta({}); };
        await apiFetch('/api/auth/me');
        setToken('abc123');
        await apiFetch('/api/auth/me');
        assert.equal(llamadas[0].headers.Authorization, undefined);
        assert.equal(llamadas[1].headers.Authorization, 'Bearer abc123');
    });

    it('convierte los errores del servidor en ApiError con su mensaje y estado', async () => {
        globalThis.fetch = async () => respuesta({ message: 'Credenciales inválidas' }, 401);
        await assert.rejects(() => apiFetch('/api/auth/login', { metodo: 'POST', cuerpo: {} }), (e) => {
            assert.ok(e instanceof ApiError);
            assert.equal(e.estado, 401);
            assert.equal(e.message, 'Credenciales inválidas');
            return true;
        });
    });

    it('avisa cuando no hay conexión con el servidor', async () => {
        globalThis.fetch = async () => { throw new TypeError('Network request failed'); };
        await assert.rejects(() => apiFetch('/api/health'), (e) => e instanceof ApiError && /conexión/.test(e.message));
    });

    it('corta la espera cuando el servidor tarda demasiado', async () => {
        globalThis.fetch = (url, { signal }) => new Promise((_, rechazar) => {
            signal.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rechazar(e); });
        });
        await assert.rejects(() => apiFetch('/api/health', { tiempoEsperaMs: 20 }), (e) => /tardó demasiado/.test(e.message));
    });

    it('envía el cuerpo como JSON', async () => {
        globalThis.fetch = async (url, opciones) => { llamadas.push(opciones); return respuesta({}); };
        await apiFetch('/api/x', { metodo: 'POST', cuerpo: { a: 1 } });
        assert.equal(llamadas[0].body, '{"a":1}');
        assert.equal(llamadas[0].method, 'POST');
    });
});
