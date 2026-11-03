// Pruebas de la lógica de comprobantes (HU8): validación previa, lectura del archivo y llamadas a la API. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_BYTES, inferirTipo, describirTamano, validarLocal, leerComoBase64, subirComprobante, listarComprobantes,
    urlComprobante, borrarComprobante, admiteComprobantes,
} from '../src/cuentas/comprobantes.js';
import { setToken } from '../src/api/client.js';

const foto = (extra = {}) => ({ uri: 'file:///cache/foto.jpg', name: 'foto.jpg', mimeType: 'image/jpeg', size: 200000, ...extra });

describe('Validación previa del archivo elegido', () => {
    it('infiere el tipo por la extensión cuando el selector no lo informa', () => {
        assert.equal(inferirTipo({ name: 'Ticket.PNG' }), 'image/png');
        assert.equal(inferirTipo({ name: 'a.jpeg', mimeType: undefined }), 'image/jpeg');
        assert.equal(inferirTipo({ name: 'a.bin', mimeType: 'application/pdf' }), 'application/pdf');
        assert.equal(inferirTipo({ name: 'a.jpg', mimeType: 'image/jpg' }), 'image/jpeg', 'image/jpg se normaliza');
        assert.equal(inferirTipo({ name: 'a.gif', mimeType: 'image/gif' }), null);
        assert.equal(inferirTipo({ name: 'sin_extension' }), null);
        assert.equal(inferirTipo(), null);
    });

    it('describe el tamaño en B, KB o MB con coma decimal', () => {
        assert.equal(describirTamano(512), '512 B');
        assert.equal(describirTamano(340 * 1024), '340 KB');
        assert.equal(describirTamano(1.25 * 1024 * 1024), '1,3 MB');
        assert.equal(describirTamano(undefined), '0 B');
    });

    it('acepta un archivo permitido y avisa lo que no sirve antes de subirlo', () => {
        assert.equal(validarLocal(foto()), null);
        assert.equal(validarLocal(foto({ size: MAX_BYTES })), null, '5 MB exactos entran');
        assert.match(validarLocal(foto({ size: MAX_BYTES + 1 })), /máximo es 5 MB/);
        assert.match(validarLocal(foto({ name: 'a.gif', mimeType: 'image/gif' })), /PNG, JPG o PDF/);
        assert.match(validarLocal(foto({ size: 0 })), /vacío/);
        assert.match(validarLocal({}), /No se pudo leer/);
        assert.match(validarLocal(null), /No se pudo leer/);
        assert.equal(validarLocal(foto({ size: undefined })), null, 'sin tamaño informado lo revisa el servidor');
    });

    it('solo las facturas abiertas admiten comprobantes', () => {
        assert.equal(admiteComprobantes('Pendiente'), true);
        assert.equal(admiteComprobantes('En revision'), true);
        assert.equal(admiteComprobantes('Pagada'), false);
        assert.equal(admiteComprobantes('Rechazada'), false);
    });
});

describe('Lectura del archivo como base64', () => {
    const lectorQueDevuelve = (resultado, falla = false) => class {
        readAsDataURL() { setTimeout(() => (falla ? this.onerror() : (this.result = resultado, this.onload())), 0); }
    };
    const fetchConBlob = async () => ({ blob: async () => ({ tamano: 3 }) });

    it('devuelve el contenido sin el prefijo data:', async () => {
        const r = await leerComoBase64('file:///x', { fetchFn: fetchConBlob, Lector: lectorQueDevuelve('data:image/jpeg;base64,/9j/4AAQ') });
        assert.equal(r, '/9j/4AAQ');
    });

    it('informa cuando el archivo no se puede leer', async () => {
        await assert.rejects(() => leerComoBase64('file:///x', { fetchFn: fetchConBlob, Lector: lectorQueDevuelve(null, true) }), /No se pudo leer/);
        await assert.rejects(() => leerComoBase64('file:///x', { fetchFn: fetchConBlob, Lector: lectorQueDevuelve('sin coma') }), /No se pudo leer/);
    });
});

describe('Llamadas a la API de comprobantes', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; setToken('T1'); });
    afterEach(() => { globalThis.fetch = fetchOriginal; setToken(null); });
    const simular = (respuesta, estado = 200) => {
        globalThis.fetch = async (url, opciones) => {
            llamadas.push({ url, opciones });
            return { ok: estado < 400, status: estado, json: async () => respuesta };
        };
    };
    const lector = class { readAsDataURL() { setTimeout(() => { this.result = 'data:image/jpeg;base64,QUJD'; this.onload(); }, 0); } };
    const deps = { fetchFn: async () => ({ blob: async () => ({}) }), Lector: lector };

    it('sube el archivo con su nombre, tipo y contenido, y devuelve lo que responde el servidor', async () => {
        simular({ comprobante: { id: 3 }, factura_estado: 'En revision' }, 201);
        const r = await subirComprobante(9, foto(), deps);
        assert.equal(r.factura_estado, 'En revision');
        assert.match(llamadas[0].url, /\/api\/cuentas\/facturas\/9\/comprobantes$/);
        assert.equal(llamadas[0].opciones.method, 'POST');
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { nombre: 'foto.jpg', tipo_mime: 'image/jpeg', contenido: 'QUJD' });
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
    });

    it('un archivo no permitido ni siquiera llega al servidor', async () => {
        simular({});
        await assert.rejects(() => subirComprobante(9, foto({ name: 'a.gif', mimeType: 'image/gif' }), deps), /PNG, JPG o PDF/);
        await assert.rejects(() => subirComprobante(9, foto({ size: MAX_BYTES + 1 }), deps), /5 MB/);
        assert.equal(llamadas.length, 0);
    });

    it('si el servidor rechaza el archivo, su mensaje llega a la pantalla', async () => {
        simular({ message: 'El archivo está dañado o incompleto' }, 400);
        await assert.rejects(() => subirComprobante(9, foto(), deps), (e) => e.estado === 400 && /dañado/.test(e.message));
    });

    it('lista, pide el enlace y borra con las rutas correctas', async () => {
        simular({ comprobantes: [] });
        await listarComprobantes(9);
        await urlComprobante(3);
        await borrarComprobante(3);
        assert.match(llamadas[0].url, /\/facturas\/9\/comprobantes$/);
        assert.match(llamadas[1].url, /\/comprobantes\/3\/url$/);
        assert.match(llamadas[2].url, /\/comprobantes\/3$/);
        assert.equal(llamadas[2].opciones.method, 'DELETE');
    });
});
