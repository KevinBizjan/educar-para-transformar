// Pruebas de la lógica de sesión con fetch simulado y almacenamiento en memoria (sin red).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearSesion, almacenMemoria, pantallaPorRol } from '../src/auth/sesion.js';
import { setToken, alSesionExpirada, apiFetch } from '../src/api/client.js';
import { validarPassword, validarCambioPassword } from '../src/utils/validators.js';

const respuesta = (cuerpo, estado = 200) => ({ ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo });
const PADRE = { id: 7, username: 'familia', nombre: 'Familia Prueba', rol: 'padre' };

describe('Sesión de la app móvil', () => {
    const fetchOriginal = globalThis.fetch;
    let almacen, sesion, llamadas;

    // Simula el backend: cada ruta devuelve (cuerpo, estado) según el guion de la prueba.
    const backend = (guion) => {
        globalThis.fetch = async (url, opciones) => {
            const ruta = new URL(url).pathname;
            llamadas.push({ ruta, opciones });
            const [cuerpo, estado] = guion[ruta] || [{ message: 'no definido' }, 404];
            if (cuerpo instanceof Error) throw cuerpo;
            return respuesta(cuerpo, estado);
        };
    };

    beforeEach(() => {
        almacen = almacenMemoria();
        sesion = crearSesion(almacen);
        llamadas = [];
        setToken(null);
        alSesionExpirada(null);
    });
    afterEach(() => { globalThis.fetch = fetchOriginal; });

    it('el login guarda el token y lo usa en las llamadas siguientes', async () => {
        backend({ '/api/auth/login': [{ token: 'T1', user: PADRE }, 200], '/api/auth/me': [PADRE, 200] });
        const s = await sesion.iniciarSesion('familia', 'Clave1!x');
        assert.equal(s.user.rol, 'padre');
        assert.match(await almacen.leer('educar.sesion'), /T1/);
        await apiFetch('/api/auth/me');
        assert.equal(llamadas[1].opciones.headers.Authorization, 'Bearer T1');
        assert.equal(JSON.parse(llamadas[0].opciones.body).username, 'familia');
    });

    it('un login con credenciales inválidas no guarda nada ni dispara el cierre de sesión', async () => {
        let avisos = 0;
        alSesionExpirada(() => { avisos++; });
        backend({ '/api/auth/login': [{ message: 'Credenciales inválidas' }, 401] });
        await assert.rejects(() => sesion.iniciarSesion('familia', 'mala'), (e) => e.estado === 401 && e.message === 'Credenciales inválidas');
        assert.equal(await almacen.leer('educar.sesion'), null);
        assert.equal(avisos, 0);
    });

    it('al abrir la app renueva la sesión guardada', async () => {
        await almacen.guardar('educar.sesion', JSON.stringify({ token: 'VIEJO', user: PADRE }));
        backend({ '/api/auth/refresh': [{ token: 'NUEVO', user: PADRE }, 200] });
        const s = await sesion.restaurarSesion();
        assert.equal(s.token, 'NUEVO');
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer VIEJO');
        assert.match(await almacen.leer('educar.sesion'), /NUEVO/);
    });

    it('si el servidor rechaza la sesión guardada, la descarta', async () => {
        await almacen.guardar('educar.sesion', JSON.stringify({ token: 'VENCIDO', user: PADRE }));
        backend({ '/api/auth/refresh': [{ message: 'Token inválido o expirado' }, 401] });
        assert.equal(await sesion.restaurarSesion(), null);
        assert.equal(await almacen.leer('educar.sesion'), null);
    });

    it('si solo falla la red, conserva la sesión guardada', async () => {
        await almacen.guardar('educar.sesion', JSON.stringify({ token: 'T1', user: PADRE }));
        backend({ '/api/auth/refresh': [new TypeError('Network request failed'), 0] });
        const s = await sesion.restaurarSesion();
        assert.equal(s.user.username, 'familia');
        assert.match(await almacen.leer('educar.sesion'), /T1/);
    });

    it('sin sesión guardada, o con datos corruptos, no restaura nada', async () => {
        assert.equal(await sesion.restaurarSesion(), null);
        await almacen.guardar('educar.sesion', '{esto no es json');
        assert.equal(await sesion.restaurarSesion(), null);
        assert.equal(await almacen.leer('educar.sesion'), null);
    });

    it('un 401 en una llamada con token avisa a la app para cerrar la sesión', async () => {
        let avisos = 0;
        alSesionExpirada(() => { avisos++; });
        setToken('T1');
        backend({ '/api/auth/me': [{ message: 'Token inválido o expirado' }, 401] });
        await assert.rejects(() => apiFetch('/api/auth/me'));
        assert.equal(avisos, 1);
    });

    it('cerrar sesión borra el token del almacenamiento y de las llamadas', async () => {
        backend({ '/api/auth/login': [{ token: 'T1', user: PADRE }, 200], '/api/auth/me': [PADRE, 200] });
        await sesion.iniciarSesion('familia', 'Clave1!x');
        await sesion.cerrarSesion();
        assert.equal(await almacen.leer('educar.sesion'), null);
        await apiFetch('/api/auth/me');
        assert.equal(llamadas[1].opciones.headers.Authorization, undefined);
    });

    it('el cambio de contraseña envía los campos que espera el backend', async () => {
        setToken('T1');
        backend({ '/api/auth/change-password': [{ message: 'Contraseña actualizada correctamente' }, 200] });
        await sesion.cambiarPassword('Actual1!x', 'Nueva2$clave');
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { password_actual: 'Actual1!x', password_nueva: 'Nueva2$clave' });
    });

    it('solo los padres entran a la app; el resto de los roles ve el aviso de acceso', () => {
        assert.equal(pantallaPorRol('padre'), 'inicio');
        for (const rol of ['admin', 'docente', 'alumno', undefined]) assert.equal(pantallaPorRol(rol), 'sin-acceso');
    });
});

describe('Validación de contraseñas (mismas reglas que el backend)', () => {
    it('rechaza las contraseñas débiles con el mismo mensaje del servidor', () => {
        assert.match(validarPassword('Ab1!'), /8 caracteres/);
        assert.match(validarPassword('minuscula1!'), /mayúscula/);
        assert.match(validarPassword('Sinnumero!'), /número/);
        assert.match(validarPassword('SinSimbolo1'), /carácter especial/);
        assert.equal(validarPassword('Valida1!x'), '');
    });

    it('el formulario de cambio exige los tres campos, coincidencia y que sea distinta', () => {
        assert.match(validarCambioPassword('', 'Nueva2$clave', 'Nueva2$clave'), /tres campos/);
        assert.match(validarCambioPassword('Actual1!x', 'Nueva2$clave', 'Otra2$clave'), /no coinciden/);
        assert.match(validarCambioPassword('Nueva2$clave', 'Nueva2$clave', 'Nueva2$clave'), /distinta/);
        assert.equal(validarCambioPassword('Actual1!x', 'Nueva2$clave', 'Nueva2$clave'), '');
    });
});
