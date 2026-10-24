// Pruebas de la lógica de "Mis hijos" (HU5): formatos, meses, caché y carga. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    nombreMes, periodoActual, mesAnterior, mesSiguiente, tituloPeriodo, formatearMonto,
    describirCurso, describirComedor, nombreServicio, obtenerEnCache, limpiarCache, cargarResumen,
} from '../src/familia/resumen.js';
import { setToken } from '../src/api/client.js';

describe('Formatos de "Mis hijos"', () => {
    it('formatea los montos en pesos con punto para los miles y coma para los centavos', () => {
        assert.equal(formatearMonto(0), '$0');
        assert.equal(formatearMonto(950), '$950');
        assert.equal(formatearMonto(12000), '$12.000');
        assert.equal(formatearMonto(1234567), '$1.234.567');
        assert.equal(formatearMonto(15000.5), '$15.000,50');
        assert.equal(formatearMonto('25000'), '$25.000');
        assert.equal(formatearMonto(null), '$0');
        assert.equal(formatearMonto(-3500), '-$3.500');
    });

    it('nombra los meses y arma el título del período', () => {
        assert.equal(nombreMes(1), 'enero');
        assert.equal(nombreMes(12), 'diciembre');
        assert.equal(nombreMes(13), '');
        assert.equal(tituloPeriodo({ mes: 6, anio: 2027 }), 'Junio 2027');
    });

    it('navega entre meses y cambia de año en diciembre y enero', () => {
        assert.deepEqual(mesSiguiente({ mes: 6, anio: 2027 }), { mes: 7, anio: 2027 });
        assert.deepEqual(mesSiguiente({ mes: 12, anio: 2027 }), { mes: 1, anio: 2028 });
        assert.deepEqual(mesAnterior({ mes: 6, anio: 2027 }), { mes: 5, anio: 2027 });
        assert.deepEqual(mesAnterior({ mes: 1, anio: 2027 }), { mes: 12, anio: 2026 });
        assert.deepEqual(periodoActual(new Date(2026, 9, 24)), { mes: 10, anio: 2026 });
    });

    it('describe el curso con nivel y división, o avisa que no tiene', () => {
        assert.equal(describirCurso({ nivel: 'Primario', division: 'A' }), 'Primario A');
        assert.equal(describirCurso({ nivel: 'Inicial', division: null }), 'Inicial');
        assert.equal(describirCurso({ nivel: null, division: null }), 'Sin curso asignado');
    });

    it('nombra los servicios sin repetir el tipo', () => {
        assert.equal(nombreServicio({ tipo: 'Deporte', nombre: 'Fútbol' }), 'Deporte: Fútbol');
        assert.equal(nombreServicio({ tipo: 'Transporte', nombre: 'Ruta Centro' }), 'Transporte: Ruta Centro');
        assert.equal(nombreServicio({ tipo: 'Comedor', nombre: 'Comedor mensual' }), 'Comedor mensual');
    });

    it('describe el consumo real del comedor', () => {
        assert.equal(describirComedor({ inscripto: true, dias_consumidos: 2, dias_registrados: 3 }), 'Comedor: comió 2 de 3 días registrados');
        assert.equal(describirComedor({ inscripto: true, dias_consumidos: 1, dias_registrados: 1 }), 'Comedor: comió 1 de 1 día registrado');
        assert.match(describirComedor({ inscripto: true, dias_consumidos: 0, dias_registrados: 0 }), /sin registros/);
        assert.equal(describirComedor({ inscripto: false, dias_consumidos: 0, dias_registrados: 0 }), null);
        assert.ok(describirComedor({ inscripto: false, dias_consumidos: 2, dias_registrados: 2 }), 'con registros se muestra aunque no figure la inscripción');
        assert.equal(describirComedor(undefined), null);
    });
});

describe('Carga y caché del resumen de la familia', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; limpiarCache(); setToken('T1'); });
    afterEach(() => { globalThis.fetch = fetchOriginal; setToken(null); });

    const datos = { mes: 6, anio: 2027, resumen: { cantidad_hijos: 1 }, hijos: [{ id: 1 }] };
    const simular = (respuesta = datos, estado = 200) => {
        globalThis.fetch = async (url, opciones) => {
            llamadas.push({ url, opciones });
            return { ok: estado < 400, status: estado, json: async () => respuesta };
        };
    };

    it('pide el período indicado con el token de la sesión y lo guarda en el caché', async () => {
        simular();
        assert.equal(obtenerEnCache({ mes: 6, anio: 2027 }), null);
        const r = await cargarResumen({ mes: 6, anio: 2027 });
        assert.deepEqual(r, datos);
        assert.match(llamadas[0].url, /\/api\/inscripciones\/resumen-familia\?mes=6&anio=2027$/);
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
        assert.deepEqual(obtenerEnCache({ mes: 6, anio: 2027 }), datos);
        assert.equal(obtenerEnCache({ mes: 7, anio: 2027 }), null, 'cada mes tiene su propio caché');
    });

    it('si la carga falla, no pisa lo que ya estaba en el caché', async () => {
        simular();
        await cargarResumen({ mes: 6, anio: 2027 });
        simular({ message: 'Error en el servidor' }, 500);
        await assert.rejects(() => cargarResumen({ mes: 6, anio: 2027 }), (e) => e.estado === 500);
        assert.deepEqual(obtenerEnCache({ mes: 6, anio: 2027 }), datos);
    });

    it('al limpiar el caché (cierre de sesión) no queda ningún dato de la familia', async () => {
        simular();
        await cargarResumen({ mes: 6, anio: 2027 });
        await cargarResumen({ mes: 7, anio: 2027 });
        limpiarCache();
        assert.equal(obtenerEnCache({ mes: 6, anio: 2027 }), null);
        assert.equal(obtenerEnCache({ mes: 7, anio: 2027 }), null);
    });
});
