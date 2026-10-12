// Pruebas unitarias de los patrones de diseño que no dependen de la base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const RolFactory = require('../src/patterns/rolFactory');
const { Publicador } = require('../src/patterns/comunicadosObserver');

describe('Factory de roles', () => {
    it('crea cada rol por su nombre', () => {
        assert.equal(RolFactory.crear('admin').etiqueta, 'Administrador');
        assert.equal(RolFactory.crear('docente').nombre, 'docente');
        assert.equal(RolFactory.crear('alumno').nombre, 'alumno');
        assert.equal(RolFactory.crear('padre').registroPublico, true);
    });

    it('solo el administrador es administrador', () => {
        const admins = RolFactory.nombres().filter(n => RolFactory.crear(n).esAdministrador);
        assert.deepEqual(admins, ['admin']);
    });

    it('un rol inexistente no se crea', () => {
        assert.equal(RolFactory.crear('director'), null);
        assert.equal(RolFactory.esValido('director'), false);
        assert.equal(RolFactory.esValido('__proto__'), false);
        assert.equal(RolFactory.esValido('toString'), false);
    });

    it('los roles creados no se pueden modificar', () => {
        const rol = RolFactory.crear('alumno');
        assert.throws(() => { 'use strict'; rol.esAdministrador = true; }, TypeError);
    });
});

describe('Observer de comunicados', () => {
    it('avisa a todos los observadores suscriptos', () => {
        const publicador = new Publicador();
        const recibidos = [];
        publicador.suscribir(e => recibidos.push(['a', e.id]));
        publicador.suscribir(e => recibidos.push(['b', e.id]));
        publicador.notificar({ id: 7 });
        assert.deepEqual(recibidos, [['a', 7], ['b', 7]]);
    });

    it('un observador que falla no frena a los demás', () => {
        const publicador = new Publicador();
        let llego = false;
        const original = console.error;
        console.error = () => {};
        try {
            publicador.suscribir(() => { throw new Error('falla a propósito'); });
            publicador.suscribir(() => { llego = true; });
            publicador.notificar({ id: 1 });
        } finally {
            console.error = original;
        }
        assert.equal(llego, true);
    });

    it('permite darse de baja', () => {
        const publicador = new Publicador();
        let veces = 0;
        const baja = publicador.suscribir(() => { veces++; });
        publicador.notificar({});
        baja();
        publicador.notificar({});
        assert.equal(veces, 1);
    });

    it('rechaza suscribir algo que no es una función', () => {
        assert.throws(() => new Publicador().suscribir('no soy una función'), TypeError);
    });
});
