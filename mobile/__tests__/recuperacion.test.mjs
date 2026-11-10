// Pruebas de la recuperación de contraseña por correo: validaciones del formulario y llamadas a la API. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validarPedido, validarRestablecer, normalizarCodigo, pedirCodigo, restablecerPassword, LARGO_CODIGO } from '../src/auth/recuperacion.js';
import { setToken } from '../src/api/client.js';

describe('Recuperación: validaciones del formulario', () => {
    it('para pedir el código hace falta un correo válido', () => {
        assert.equal(validarPedido('ana@correo.com'), '');
        assert.equal(validarPedido('  ana@correo.com  '), '');
        assert.match(validarPedido(''), /Escribí el correo/);
        assert.match(validarPedido('   '), /Escribí el correo/);
        for (const malo of ['ana', 'ana@', '@correo.com', 'ana@correo', 'a na@correo.com']) assert.match(validarPedido(malo), /correo válido/, malo);
    });

    it('para cambiar la contraseña hace falta el código de 6 dígitos y una contraseña válida repetida igual', () => {
        const ok = { codigo: '123456', password: 'Nueva123!', repetida: 'Nueva123!' };
        assert.equal(validarRestablecer(ok), '');
        assert.match(validarRestablecer({ ...ok, codigo: '' }), /Completá/);
        assert.match(validarRestablecer({ ...ok, password: '' }), /Completá/);
        assert.match(validarRestablecer({ ...ok, repetida: '' }), /Completá/);
        for (const malo of ['12345', '1234567', 'abcdef', '12 456']) assert.equal(validarRestablecer({ ...ok, codigo: malo }), `El código tiene ${LARGO_CODIGO} dígitos.`, malo);
        assert.match(validarRestablecer({ ...ok, password: 'corta1!', repetida: 'corta1!' }), /al menos 8 caracteres/);
        assert.match(validarRestablecer({ ...ok, password: 'sinmayus1!', repetida: 'sinmayus1!' }), /mayúscula/);
        assert.match(validarRestablecer({ ...ok, repetida: 'Otra1234!' }), /no coinciden/);
    });

    it('el código se limpia: solo dígitos y hasta 6, aunque se pegue con espacios o guiones', () => {
        assert.equal(normalizarCodigo('123 456'), '123456');
        assert.equal(normalizarCodigo('12-34-56'), '123456');
        assert.equal(normalizarCodigo('1234567890'), '123456');
        assert.equal(normalizarCodigo('ab12'), '12');
        assert.equal(normalizarCodigo(null), '');
    });
});

describe('Recuperación: llamadas a la API', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; setToken(null); });
    afterEach(() => { globalThis.fetch = fetchOriginal; });
    const simular = (respuesta, estado = 200) => {
        globalThis.fetch = async (url, opciones) => {
            llamadas.push({ url, opciones });
            return { ok: estado < 400, status: estado, json: async () => respuesta };
        };
    };

    it('pide el código con el correo en minúsculas y sin espacios, sin sesión', async () => {
        simular({ message: 'Si la cuenta existe...' });
        const r = await pedirCodigo('  Ana@Correo.COM ');
        assert.equal(r.message, 'Si la cuenta existe...');
        assert.match(llamadas[0].url, /\/api\/auth\/recuperar$/);
        assert.equal(llamadas[0].opciones.method, 'POST');
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { usuario: 'ana@correo.com' });
        assert.equal(llamadas[0].opciones.headers.Authorization, undefined, 'no hay sesión: no se manda token');
    });

    it('cambia la contraseña con el correo, el código y la contraseña nueva', async () => {
        simular({ message: 'Contraseña actualizada.' });
        await restablecerPassword({ correo: 'Ana@correo.com', codigo: ' 123456 ', password: 'Nueva123!' });
        assert.match(llamadas[0].url, /\/api\/auth\/restablecer$/);
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { usuario: 'ana@correo.com', codigo: '123456', password: 'Nueva123!' });
    });

    it('el mensaje del servidor llega a la pantalla cuando rechaza', async () => {
        simular({ message: 'El código no es válido o venció. Pedí uno nuevo.' }, 400);
        await assert.rejects(() => restablecerPassword({ correo: 'a@b.co', codigo: '000000', password: 'Nueva123!' }), (e) => e.estado === 400 && /no es válido o venció/.test(e.message));
        simular({ message: 'La recuperación por correo no está disponible por ahora.' }, 503);
        await assert.rejects(() => pedirCodigo('a@b.co'), (e) => e.estado === 503 && /no está disponible/.test(e.message));
    });
});
