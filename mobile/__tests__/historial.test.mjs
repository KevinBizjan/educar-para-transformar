// Pruebas de la lógica del historial (HU9): rangos de fechas, textos y llamadas a la API. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RANGOS, rangoRapido, describirRango, cargarHistorial, enlacePdf, filasResumen, mensajeHistorialVacio } from '../src/cuentas/historial.js';
import { setToken } from '../src/api/client.js';

describe('Rangos de fechas del historial', () => {
    it('ofrece cuatro opciones rápidas', () => {
        assert.deepEqual(RANGOS.map((r) => r.id), ['mes', 'tres', 'anio', 'todo']);
    });

    it('calcula cada rango a partir de hoy', () => {
        const hoy = new Date(2026, 10, 3); // 3 de noviembre de 2026
        assert.deepEqual(rangoRapido('mes', hoy), { desde: '2026-11-01', hasta: '2026-11-03' });
        assert.deepEqual(rangoRapido('tres', hoy), { desde: '2026-09-01', hasta: '2026-11-03' });
        assert.deepEqual(rangoRapido('anio', hoy), { desde: '2026-01-01', hasta: '2026-11-03' });
        assert.deepEqual(rangoRapido('todo', hoy), { desde: null, hasta: null });
    });

    it('los últimos tres meses cruzan el cambio de año', () => {
        assert.deepEqual(rangoRapido('tres', new Date(2027, 0, 15)), { desde: '2026-11-01', hasta: '2027-01-15' });
        assert.deepEqual(rangoRapido('tres', new Date(2027, 1, 28)), { desde: '2026-12-01', hasta: '2027-02-28' });
        assert.deepEqual(rangoRapido('tres', new Date(2027, 2, 1)), { desde: '2027-01-01', hasta: '2027-03-01' });
    });

    it('el último día del mes y los días de un dígito salen bien formados', () => {
        assert.deepEqual(rangoRapido('mes', new Date(2028, 1, 29)), { desde: '2028-02-01', hasta: '2028-02-29' });
        assert.equal(rangoRapido('mes', new Date(2026, 4, 5)).hasta, '2026-05-05');
    });

    it('una opción desconocida equivale a todo el historial', () => {
        assert.deepEqual(rangoRapido('inventada'), { desde: null, hasta: null });
    });

    it('describe el rango en texto', () => {
        assert.equal(describirRango({ desde: '2026-03-01', hasta: '2026-05-15' }), '01/03/2026 al 15/05/2026');
        assert.equal(describirRango({ desde: '2026-03-01', hasta: null }), 'Desde el 01/03/2026');
        assert.equal(describirRango({ desde: null, hasta: '2026-05-15' }), 'Hasta el 15/05/2026');
        assert.equal(describirRango({ desde: null, hasta: null }), 'Todo el historial');
    });
});

describe('Textos del resumen', () => {
    it('muestra lo facturado, pagado y pendiente, y lo rechazado solo si hay', () => {
        const base = { total_facturado: 100, total_pagado: 60, total_pendiente: 40, total_rechazado: 0 };
        assert.deepEqual(filasResumen(base).map((f) => f.texto), ['Facturado', 'Pagado', 'Pendiente']);
        const con = filasResumen({ ...base, total_rechazado: 15 });
        assert.deepEqual(con.map((f) => f.texto), ['Facturado', 'Pagado', 'Pendiente', 'Rechazado']);
        assert.equal(con.find((f) => f.texto === 'Pendiente').alerta, true);
        assert.equal(filasResumen({ ...base, total_pendiente: 0 }).find((f) => f.texto === 'Pendiente').alerta, false);
    });

    it('el mensaje de vacío depende de si hay un rango', () => {
        assert.match(mensajeHistorialVacio({ desde: '2026-01-01', hasta: null }), /rango más amplio/);
        assert.match(mensajeHistorialVacio({ desde: null, hasta: null }), /Todavía no generaste/);
    });
});

describe('Llamadas a la API del historial', () => {
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

    it('pide el historial con el rango solo si lo hay', async () => {
        simular({ facturas: [] });
        await cargarHistorial({ desde: '2026-03-01', hasta: '2026-05-15' });
        await cargarHistorial({ desde: null, hasta: null });
        await cargarHistorial({ desde: '2026-03-01', hasta: null });
        assert.match(llamadas[0].url, /\/api\/cuentas\/historial\?desde=2026-03-01&hasta=2026-05-15$/);
        assert.match(llamadas[1].url, /\/api\/cuentas\/historial$/);
        assert.match(llamadas[2].url, /\/api\/cuentas\/historial\?desde=2026-03-01$/);
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
    });

    it('pide el enlace del PDF y devuelve la dirección completa', async () => {
        simular({ ruta: '/api/cuentas/pdf/abc.def.ghi', vence_en_segundos: 300 });
        const url = await enlacePdf({ tipo: 'factura', id: 7 });
        assert.match(llamadas[0].url, /\/api\/cuentas\/pdf-enlace\?tipo=factura&id=7$/);
        assert.match(url, /^https?:\/\/[^/]+\/api\/cuentas\/pdf\/abc\.def\.ghi$/);
        await enlacePdf({ tipo: 'historial', desde: '2026-03-01', hasta: '2026-05-15' });
        assert.match(llamadas[1].url, /pdf-enlace\?tipo=historial&desde=2026-03-01&hasta=2026-05-15$/);
    });

    it('si el servidor rechaza, el mensaje llega a la pantalla', async () => {
        simular({ message: 'La fecha "desde" no es válida (usá AAAA-MM-DD)' }, 400);
        await assert.rejects(() => cargarHistorial({ desde: 'x', hasta: null }), (e) => e.estado === 400 && /no es válida/.test(e.message));
    });
});
