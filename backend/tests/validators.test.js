const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    esDniValido, esEmailValido, esNombreValido, validarPassword, esEdadValida
} = require('../src/utils/validators');

test('RF09/RF11: el DNI debe ser numérico, sin puntos ni letras', () => {
    assert.equal(esDniValido('45111222'), true);
    assert.equal(esDniValido('45.111.222'), false);
    assert.equal(esDniValido('4511A222'), false);
    assert.equal(esDniValido(''), false);
});

test('RF09: el correo debe tener una estructura válida', () => {
    assert.equal(esEmailValido('familia@mail.com'), true);
    assert.equal(esEmailValido('no-es-un-correo'), false);
    assert.equal(esEmailValido('falta@punto'), false);
    assert.equal(esEmailValido(''), false);
});

test('Los nombres admiten letras con acentos y rechazan números', () => {
    assert.equal(esNombreValido('María José'), true);
    assert.equal(esNombreValido("D'Angelo"), true);
    assert.equal(esNombreValido('Juan3'), false);
    assert.equal(esNombreValido(''), false);
});

test('La contraseña exige 8 caracteres, mayúscula, número y símbolo', () => {
    assert.equal(validarPassword('Abcdef1!'), '');
    assert.notEqual(validarPassword('Ab1!'), '');
    assert.notEqual(validarPassword('abcdef1!'), '');
    assert.notEqual(validarPassword('Abcdefg!'), '');
    assert.notEqual(validarPassword('Abcdefg1'), '');
});

test('RF09: la edad del aspirante debe ser un entero dentro del rango', () => {
    assert.equal(esEdadValida(3, 3, 18), true);
    assert.equal(esEdadValida('7', 3, 18), true);
    assert.equal(esEdadValida(2, 3, 18), false);
    assert.equal(esEdadValida(19, 3, 18), false);
    assert.equal(esEdadValida(7.5, 3, 18), false);
});
