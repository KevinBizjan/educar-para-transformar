// Reglas puras de las inscripciones a servicios (HU4): no usan la base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_DEPORTES_POR_ALUMNO, validarMesAnio, validarPeriodoInscripcion, rangoDelMes, ReglaError,
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
});
