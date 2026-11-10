// Pruebas de la inscripción a servicios desde la app: armado de la lista y llamadas a la API. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PERIODOS, periodoElegido, agruparCatalogo, tituloServicio, detalleServicio, describirCupo, inscripcionDe, accionDe, ordenarServicios,
    cargarCatalogo, cargarInscripciones, inscribir, darDeBaja,
} from '../src/familia/servicios.js';
import { obtenerEnCache, cargarResumen } from '../src/familia/resumen.js';
import { setToken } from '../src/api/client.js';

const futbol = { id: 1, tipo: 'Deporte', nombre: 'Fútbol Primario', deporte: 'Fútbol', nivel: 'Primario', docente: 'Laura Pérez', dia_semana: 1, hora_inicio: '16:00', hora_fin: '17:30', precio_mensual: '6000.00', cupo_disponible: 3 };
const natacion = { id: 2, tipo: 'Deporte', nombre: 'Natación Primario', deporte: 'Natación', nivel: 'Primario', docente: 'Juan Gómez', dia_semana: 3, hora_inicio: '10:00', hora_fin: '11:00', precio_mensual: 7000.5, cupo_disponible: 0 };
const recorrido = { id: 3, tipo: 'Transporte', nombre: 'Transporte: Recorrido Norte', precio_mensual: 9000, cupo_disponible: null };
const comedor = { id: 4, tipo: 'Comedor', nombre: 'Comedor mensual', precio_mensual: '15000', cupo_disponible: 1 };

describe('Servicios: período y lista', () => {
    it('se puede inscribir en este mes y en el siguiente', () => {
        assert.deepEqual(PERIODOS.map((p) => p.id), ['actual', 'siguiente']);
        const hoy = new Date(2026, 10, 3);
        assert.deepEqual(periodoElegido('actual', hoy), { mes: 11, anio: 2026 });
        assert.deepEqual(periodoElegido('siguiente', hoy), { mes: 12, anio: 2026 });
        assert.deepEqual(periodoElegido('siguiente', new Date(2026, 11, 20)), { mes: 1, anio: 2027 }, 'diciembre pasa a enero del año siguiente');
    });

    it('agrupa en Deportes, Transporte y Comedor, en ese orden y sin grupos vacíos', () => {
        const grupos = agruparCatalogo([comedor, recorrido, natacion, futbol]);
        assert.deepEqual(grupos.map((g) => [g.titulo, g.servicios.length]), [['Deportes', 2], ['Transporte', 1], ['Comedor', 1]]);
        assert.deepEqual(agruparCatalogo([comedor]).map((g) => g.tipo), ['Comedor']);
        assert.deepEqual(agruparCatalogo([]), []);
    });

    it('el título del deporte lleva el nivel y el de los demás servicios, su nombre', () => {
        assert.equal(tituloServicio(futbol), 'Fútbol · Primario');
        assert.equal(tituloServicio(recorrido), 'Transporte: Recorrido Norte');
        assert.equal(tituloServicio({ tipo: 'Deporte', nombre: 'Grupo sin deporte' }), 'Grupo sin deporte');
    });

    it('el detalle del deporte muestra horario, profesor y precio; el de los demás, solo el precio', () => {
        assert.deepEqual(detalleServicio(futbol), ['Lunes 16:00 a 17:30', 'Profesor: Laura Pérez', '$6.000 por mes']);
        assert.deepEqual(detalleServicio(natacion), ['Miércoles 10:00 a 11:00', 'Profesor: Juan Gómez', '$7.000,50 por mes']);
        assert.deepEqual(detalleServicio(recorrido), ['$9.000 por mes']);
        assert.deepEqual(detalleServicio(comedor), ['$15.000 por mes']);
    });

    it('describe el cupo del mes', () => {
        assert.equal(describirCupo({ cupo_disponible: null }), 'Sin límite de lugares');
        assert.equal(describirCupo({}), 'Sin límite de lugares');
        assert.equal(describirCupo({ cupo_disponible: 0 }), 'Sin lugares disponibles');
        assert.equal(describirCupo({ cupo_disponible: 1 }), 'Queda 1 lugar');
        assert.equal(describirCupo({ cupo_disponible: 5 }), 'Quedan 5 lugares');
    });
});

describe('Servicios: qué botón corresponde', () => {
    const inscripciones = [{ id: 90, servicio_id: 1 }, { id: 91, servicio_id: 4 }];

    it('si el hijo ya está inscripto se ofrece la baja, aunque el cupo esté completo', () => {
        assert.equal(inscripcionDe(futbol, inscripciones).id, 90);
        assert.equal(accionDe(futbol, inscripciones), 'baja');
        assert.equal(accionDe({ ...comedor, cupo_disponible: 0 }, inscripciones), 'baja', 'quien ya tiene el lugar puede soltarlo');
    });

    it('si no está inscripto se ofrece inscribir, salvo que no queden lugares', () => {
        assert.equal(accionDe(recorrido, inscripciones), 'inscribir');
        assert.equal(accionDe(recorrido, []), 'inscribir', 'sin límite de cupo');
        assert.equal(accionDe(natacion, inscripciones), 'completo');
        assert.equal(inscripcionDe(natacion, inscripciones), null);
    });

    it('los servicios en los que ya está inscripto van primero, sin perder el orden del resto', () => {
        assert.deepEqual(ordenarServicios([futbol, natacion, recorrido, comedor], [{ servicio_id: 4 }]).map((s) => s.id), [4, 1, 2, 3]);
        assert.deepEqual(ordenarServicios([futbol, natacion], []).map((s) => s.id), [1, 2]);
    });
});

describe('Servicios: llamadas a la API', () => {
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

    it('pide el catálogo y las inscripciones del hijo del mes elegido', async () => {
        simular({ servicios: [] });
        await cargarCatalogo({ mes: 12, anio: 2026 });
        await cargarInscripciones(7, { mes: 12, anio: 2026 });
        assert.match(llamadas[0].url, /\/api\/inscripciones\/catalogo\?mes=12&anio=2026$/);
        assert.match(llamadas[1].url, /\/api\/inscripciones\/alumno\/7\?mes=12&anio=2026$/);
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
    });

    it('inscribe con el hijo, el servicio y el período', async () => {
        simular({ id: 55 }, 201);
        const r = await inscribir({ alumnoId: 7, servicioId: 1, mes: 12, anio: 2026 });
        assert.equal(r.id, 55);
        assert.match(llamadas[0].url, /\/api\/inscripciones$/);
        assert.equal(llamadas[0].opciones.method, 'POST');
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { alumno_id: 7, servicio_id: 1, mes: 12, anio: 2026 });
    });

    it('da de baja una inscripción por su número', async () => {
        simular({ message: 'ok' });
        await darDeBaja(55);
        assert.match(llamadas[0].url, /\/api\/inscripciones\/55$/);
        assert.equal(llamadas[0].opciones.method, 'DELETE');
    });

    it('el mensaje del servidor llega a la pantalla cuando rechaza (límite de deportes, cupo, baja ya facturada)', async () => {
        simular({ message: 'Un alumno puede inscribirse como máximo a 2 deportes por mes.' }, 400);
        await assert.rejects(() => inscribir({ alumnoId: 7, servicioId: 1, mes: 12, anio: 2026 }), (e) => e.estado === 400 && /máximo a 2 deportes/.test(e.message));
        simular({ message: 'No se puede dar de baja: la inscripción ya figura en una factura.' }, 409);
        await assert.rejects(() => darDeBaja(55), (e) => e.estado === 409 && /ya figura en una factura/.test(e.message));
    });

    it('inscribir o dar de baja borra el caché de "Mis hijos", para que se vea el cambio', async () => {
        simular({ hijos: [], resumen: {} });
        await cargarResumen({ mes: 12, anio: 2026 });
        assert.ok(obtenerEnCache({ mes: 12, anio: 2026 }), 'el resumen quedó en caché');
        simular({ id: 1 }, 201);
        await inscribir({ alumnoId: 7, servicioId: 1, mes: 12, anio: 2026 });
        assert.equal(obtenerEnCache({ mes: 12, anio: 2026 }), null);
        simular({ hijos: [], resumen: {} });
        await cargarResumen({ mes: 12, anio: 2026 });
        simular({ message: 'ok' });
        await darDeBaja(1);
        assert.equal(obtenerEnCache({ mes: 12, anio: 2026 }), null);
    });
});
