// Reglas puras de los vínculos cuenta ↔ legajo y de las vacantes de un curso. Sin base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leerUserId, validarRolDeCuenta, vacantes } = require('../src/utils/vinculos');

describe('Vínculos: lectura de la cuenta', () => {
    it('vacío o null significa desvincular', () => {
        assert.equal(leerUserId(null), null);
        assert.equal(leerUserId(undefined), null);
        assert.equal(leerUserId(''), null);
    });

    it('acepta enteros positivos, también como texto', () => {
        assert.equal(leerUserId(7), 7);
        assert.equal(leerUserId('12'), 12);
    });

    it('rechaza lo que no es un identificador válido', () => {
        for (const malo of [0, -3, 1.5, 'abc', NaN, {}, [], true]) {
            assert.equal(leerUserId(malo), undefined, `debería rechazar ${JSON.stringify(malo)}`);
        }
    });
});

describe('Vínculos: rol de la cuenta', () => {
    it('el alumno se vincula a cuentas de alumno y el docente a cuentas de docente', () => {
        assert.equal(validarRolDeCuenta('alumno', 'alumno'), '');
        assert.equal(validarRolDeCuenta('docente', 'docente'), '');
    });

    it('rechaza una cuenta con otro rol', () => {
        assert.match(validarRolDeCuenta('docente', 'padre'), /rol "docente"/);
        assert.match(validarRolDeCuenta('alumno', 'docente'), /rol "alumno"/);
        assert.match(validarRolDeCuenta('docente', 'admin'), /rol "docente"/);
    });

    it('rechaza un tipo de legajo desconocido', () => {
        assert.equal(validarRolDeCuenta('padre', 'padre'), 'Tipo de legajo inválido');
    });
});

describe('Vínculos: vacantes de un curso', () => {
    it('es el cupo menos los inscriptos', () => {
        assert.equal(vacantes(30, 12), 18);
        assert.equal(vacantes(1, 0), 1);
    });

    it('nunca es negativa, aunque haya más inscriptos que cupo', () => {
        assert.equal(vacantes(1, 1), 0);
        assert.equal(vacantes(20, 25), 0);
    });

    it('acepta números que llegan como texto desde la base', () => {
        assert.equal(vacantes('30', '5'), 25);
    });
});
