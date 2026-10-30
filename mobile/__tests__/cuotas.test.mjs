// Pruebas de la lógica de "Cuotas" (HU6): textos, agrupación, caché y carga. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FILTROS, formatearFecha, formatearMomento, tituloCuota, etiquetaEstado, colorEstado, describirVencimiento, describirAbonado,
    mensajeVacio, agruparPorHijo, describirPago, obtenerEnCacheCuotas, limpiarCacheCuotas, cargarCuotas,
} from '../src/cuentas/cuotas.js';
import { formatearMonto } from '../src/familia/resumen.js';
import { setToken } from '../src/api/client.js';

describe('Textos de las cuotas', () => {
    it('ofrece los tres filtros del plan: pendientes, pagadas e historial', () => {
        assert.deepEqual(FILTROS.map((f) => f.id), ['pendientes', 'pagadas', 'historial']);
    });

    it('formatea las fechas como DD/MM/AAAA y un dato faltante como guion', () => {
        assert.equal(formatearFecha('2026-03-10'), '10/03/2026');
        assert.equal(formatearFecha('2026-03-10T00:00:00.000Z'), '10/03/2026');
        for (const vacio of [null, undefined, '', 'mañana']) assert.equal(formatearFecha(vacio), '-');
    });

    it('muestra el momento de un pago en hora de Argentina', () => {
        assert.equal(formatearMomento('2026-10-16T01:30:00.000Z'), '15/10/2026 22:30');
        assert.equal(formatearMomento('2026-01-01T02:00:00.000Z'), '31/12/2025 23:00', 'cruza el cambio de año');
        assert.equal(formatearMomento('no es una fecha'), '-');
    });

    it('titula la cuota con el mes en mayúscula inicial y el año', () => {
        assert.equal(tituloCuota({ mes: 3, anio: 2026 }), 'Cuota de Marzo 2026');
        assert.equal(tituloCuota({ mes: 12, anio: 2027 }), 'Cuota de Diciembre 2027');
    });

    it('describe el vencimiento según el estado de la cuota', () => {
        assert.equal(describirVencimiento({ estado: 'Pendiente', vencimiento: '2026-11-10' }), 'Vence el 10/11/2026');
        assert.equal(describirVencimiento({ estado: 'Vencida', vencimiento: '2026-03-10' }), 'Venció el 10/03/2026');
        assert.equal(describirVencimiento({ estado: 'En revision', vencimiento: '2026-03-10' }), 'Pago en revisión');
        assert.equal(describirVencimiento({ estado: 'Pagada', vencimiento: '2026-03-10' }), 'Pagada');
    });

    it('etiqueta y colorea cada estado, y los desconocidos no rompen la pantalla', () => {
        assert.equal(etiquetaEstado('En revision'), 'En revisión');
        assert.equal(etiquetaEstado('Vencida'), 'Vencida');
        assert.equal(etiquetaEstado('Otro'), 'Otro');
        assert.notEqual(colorEstado('Pagada').fondo, colorEstado('Vencida').fondo);
        assert.ok(colorEstado('inventado').fondo);
    });

    it('avisa cuánto se abonó solo cuando el pago es parcial', () => {
        assert.equal(describirAbonado({ estado: 'Vencida', pagado: 5000, saldo: 10000 }, formatearMonto), 'Abonado $5.000 · Resta $10.000');
        assert.equal(describirAbonado({ estado: 'Pendiente', pagado: 0, saldo: 15000 }, formatearMonto), null);
        assert.equal(describirAbonado({ estado: 'Pagada', pagado: 15000, saldo: 0 }, formatearMonto), null);
    });

    it('sin deuda el mensaje es una buena noticia', () => {
        assert.match(mensajeVacio('pendientes'), /al día/);
        assert.match(mensajeVacio('pagadas'), /pagadas/);
        assert.match(mensajeVacio('historial'), /pagos/);
    });

    it('agrupa las cuotas por hijo conservando el orden', () => {
        const grupos = agruparPorHijo([
            { alumno_id: 1, alumno: 'Paz, Ana', cuota_id: 10 }, { alumno_id: 2, alumno: 'Paz, Leo', cuota_id: 11 },
            { alumno_id: 1, alumno: 'Paz, Ana', cuota_id: 12 },
        ]);
        assert.deepEqual(grupos.map((g) => [g.alumno, g.cuotas.map((c) => c.cuota_id)]), [['Paz, Ana', [10, 12]], ['Paz, Leo', [11]]]);
        assert.deepEqual(agruparPorHijo([]), []);
    });

    it('describe un pago con su cuota y su método', () => {
        assert.equal(describirPago({ cuota_mes: 4, cuota_anio: 2026, metodo_pago: 'Transferencia' }), 'Cuota de Abril 2026 · Transferencia');
        assert.equal(describirPago({ cuota_mes: null, metodo_pago: null }), 'Pago');
    });
});

describe('Carga y caché de las cuotas', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; limpiarCacheCuotas(); setToken('T1'); });
    afterEach(() => { globalThis.fetch = fetchOriginal; setToken(null); });

    const datos = { filtro: 'pendientes', cuotas: [{ cuota_id: 1 }], total_pendiente: 15000, hay_deuda: true };
    const simular = (respuesta = datos, estado = 200) => {
        globalThis.fetch = async (url, opciones) => {
            llamadas.push({ url, opciones });
            return { ok: estado < 400, status: estado, json: async () => respuesta };
        };
    };

    it('pide el filtro indicado con el token de la sesión y lo guarda en el caché', async () => {
        simular();
        assert.equal(obtenerEnCacheCuotas('pendientes'), null);
        assert.deepEqual(await cargarCuotas('pendientes'), datos);
        assert.match(llamadas[0].url, /\/api\/cuentas\/cuotas\?estado=pendientes$/);
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
        assert.deepEqual(obtenerEnCacheCuotas('pendientes'), datos);
        assert.equal(obtenerEnCacheCuotas('pagadas'), null, 'cada filtro tiene su propio caché');
    });

    it('si la carga falla, no pisa lo que ya estaba en el caché', async () => {
        simular();
        await cargarCuotas('pendientes');
        simular({ message: 'Error en el servidor' }, 500);
        await assert.rejects(() => cargarCuotas('pendientes'), (e) => e.estado === 500);
        assert.deepEqual(obtenerEnCacheCuotas('pendientes'), datos);
    });

    it('al limpiar el caché (cierre de sesión) no queda ningún dato de la familia', async () => {
        simular();
        await cargarCuotas('pendientes');
        await cargarCuotas('historial');
        limpiarCacheCuotas();
        assert.equal(obtenerEnCacheCuotas('pendientes'), null);
        assert.equal(obtenerEnCacheCuotas('historial'), null);
    });
});
