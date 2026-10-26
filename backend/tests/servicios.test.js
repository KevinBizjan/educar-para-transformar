// Reglas puras de transporte y comedor (ARTE-2, Sprint D). Sin base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leerId, hayLugarEnRuta, leerConsumioMenu } = require('../src/utils/servicios');

describe('Servicios: identificadores del pedido', () => {
    it('acepta enteros positivos, también como texto', () => {
        assert.equal(leerId(7), 7);
        assert.equal(leerId('12'), 12);
    });

    it('rechaza lo que no es un identificador válido', () => {
        for (const malo of [0, -1, 1.5, '', '  ', 'abc', NaN, null, undefined, true, {}, []]) {
            assert.equal(leerId(malo), null, `debería rechazar ${JSON.stringify(malo)}`);
        }
    });
});

describe('Servicios: lugar en el recorrido', () => {
    it('hay lugar mientras los ocupados no lleguen a la capacidad', () => {
        assert.equal(hayLugarEnRuta(20, 19, false), true);
        assert.equal(hayLugarEnRuta(20, 20, false), false);
        assert.equal(hayLugarEnRuta(20, 25, false), false);
    });

    it('quien ya viaja en el recorrido no ocupa un lugar nuevo', () => {
        assert.equal(hayLugarEnRuta(20, 20, true), true);
    });

    it('sin capacidad definida no hay límite', () => {
        assert.equal(hayLugarEnRuta(null, 500, false), true);
        assert.equal(hayLugarEnRuta(undefined, 500, false), true);
    });

    it('una capacidad de cero no deja subir a nadie', () => {
        assert.equal(hayLugarEnRuta(0, 0, false), false);
    });
});

describe('Servicios: consumo del menú', () => {
    it('sin dato se toma como que sí consumió', () => {
        for (const v of [undefined, null, '']) assert.equal(leerConsumioMenu(v), true);
    });

    it('acepta true/false y 1/0 (el panel docente manda 1 o 0)', () => {
        for (const v of [true, 1, '1', 'true']) assert.equal(leerConsumioMenu(v), true);
        for (const v of [false, 0, '0', 'false']) assert.equal(leerConsumioMenu(v), false);
    });

    it('rechaza cualquier otro valor', () => {
        for (const v of ['quizás', 2, -1, {}, []]) assert.equal(leerConsumioMenu(v), undefined, `debería rechazar ${JSON.stringify(v)}`);
    });
});
