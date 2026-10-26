// Reglas puras de las inscripciones a servicios (HU4): no usan la base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_DEPORTES_POR_ALUMNO, validarMesAnio, validarPeriodoInscripcion, rangoDelMes, puedeGestionarTipo, leerPeriodo, periodoDeFecha, ReglaError,
} = require('../src/utils/inscripciones');

describe('Reglas de inscripción a servicios', () => {
    it('un alumno puede estar en 2 deportes por mes', () => {
        assert.equal(MAX_DEPORTES_POR_ALUMNO, 2);
    });

    it('valida el formato de mes y año', () => {
        assert.equal(validarMesAnio(1, 2027), '');
        assert.equal(validarMesAnio(12, 2027), '');
        assert.match(validarMesAnio(0, 2027), /entre 1 y 12/);
        assert.match(validarMesAnio(13, 2027), /entre 1 y 12/);
        assert.match(validarMesAnio(NaN, 2027), /entre 1 y 12/);
        assert.match(validarMesAnio(3, 1999), /año/);
        assert.match(validarMesAnio(3, NaN), /año/);
    });

    it('acepta el mes actual y los futuros, y rechaza los meses que ya pasaron', () => {
        const hoy = new Date(2026, 9, 15); // 15 de octubre de 2026
        assert.equal(validarPeriodoInscripcion(10, 2026, hoy), '');
        assert.equal(validarPeriodoInscripcion(11, 2026, hoy), '');
        assert.equal(validarPeriodoInscripcion(1, 2027, hoy), '');
        assert.match(validarPeriodoInscripcion(9, 2026, hoy), /ya pasó/);
        assert.match(validarPeriodoInscripcion(12, 2025, hoy), /ya pasó/);
    });

    it('el cambio de año se calcula bien (diciembre a enero)', () => {
        const diciembre = new Date(2026, 11, 20);
        assert.equal(validarPeriodoInscripcion(12, 2026, diciembre), '');
        assert.equal(validarPeriodoInscripcion(1, 2027, diciembre), '');
        assert.match(validarPeriodoInscripcion(11, 2026, diciembre), /ya pasó/);
    });

    it('calcula el rango de fechas de un mes, incluido el cambio de año', () => {
        assert.deepEqual(rangoDelMes(6, 2027), { desde: '2027-06-01', hasta: '2027-07-01' });
        assert.deepEqual(rangoDelMes(1, 2027), { desde: '2027-01-01', hasta: '2027-02-01' });
        assert.deepEqual(rangoDelMes(9, 2027), { desde: '2027-09-01', hasta: '2027-10-01' });
        assert.deepEqual(rangoDelMes(12, 2027), { desde: '2027-12-01', hasta: '2028-01-01' });
    });

    it('ReglaError lleva el código HTTP', () => {
        const e = new ReglaError(409, 'Sin cupo');
        assert.equal(e.estado, 409);
        assert.equal(e.message, 'Sin cupo');
        assert.ok(e instanceof Error);
    });

    it('el administrador y el padre gestionan los tres tipos de servicio', () => {
        for (const rol of ['admin', 'padre']) {
            for (const tipo of ['Deporte', 'Transporte', 'Comedor']) assert.equal(puedeGestionarTipo(rol, tipo), true, rol + ' ' + tipo);
        }
    });

    it('el alumno solo gestiona deportes: transporte y comedor los decide la familia', () => {
        assert.equal(puedeGestionarTipo('alumno', 'Deporte'), true);
        assert.equal(puedeGestionarTipo('alumno', 'Transporte'), false);
        assert.equal(puedeGestionarTipo('alumno', 'Comedor'), false);
    });

    it('un rol desconocido o un tipo desconocido no puede gestionar nada', () => {
        assert.equal(puedeGestionarTipo('docente', 'Deporte'), false);
        assert.equal(puedeGestionarTipo(undefined, 'Deporte'), false);
        assert.equal(puedeGestionarTipo('alumno', 'Cultura'), false);
    });

    it('lee el mes y el año del pedido, y usa el mes actual si no vienen', () => {
        const hoy = new Date(2026, 9, 25); // 25/10/2026
        assert.deepEqual(leerPeriodo({}, hoy), { mes: 10, anio: 2026, error: '' });
        assert.deepEqual(leerPeriodo({ mes: '3', anio: '2027' }, hoy), { mes: 3, anio: 2027, error: '' });
        assert.deepEqual(leerPeriodo({ mes: '3' }, hoy), { mes: 3, anio: 2026, error: '' });
    });

    it('avisa cuando el mes o el año del pedido no son válidos', () => {
        assert.match(leerPeriodo({ mes: '13', anio: '2026' }).error, /mes/);
        assert.match(leerPeriodo({ mes: 'abril', anio: '2026' }).error, /mes/);
        assert.match(leerPeriodo({ mes: '5', anio: '1999' }).error, /año/);
    });

    it('obtiene el mes y el año de una fecha AAAA-MM-DD', () => {
        assert.deepEqual(periodoDeFecha('2026-10-25'), { mes: 10, anio: 2026 });
        assert.deepEqual(periodoDeFecha('2027-01-01'), { mes: 1, anio: 2027 });
        assert.deepEqual(periodoDeFecha('2026-12-31T23:59:00'), { mes: 12, anio: 2026 });
    });
});
