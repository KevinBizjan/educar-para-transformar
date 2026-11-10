// Recuperación de contraseña por correo (app móvil): reglas puras y API contra un PostgreSQL local, con un proveedor
// de correo falso (nunca se envía nada de verdad).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { usarProveedor } = require('../src/services/correo');
const {
    MAX_INTENTOS, ESPERA_SEGUNDOS, MENSAJE_PEDIDO, MENSAJE_CODIGO_INVALIDO, crearCodigo, formatoDeCodigo, huellaDeCodigo, huellasIguales, estadoDeCodigo, debeEsperar, armarCorreoCodigo,
} = require('../src/utils/recuperacion');

describe('Recuperación: reglas puras', () => {
    it('el código tiene siempre 6 dígitos, también cuando empieza con ceros', () => {
        for (let i = 0; i < 300; i++) assert.match(crearCodigo(), /^\d{6}$/);
        const original = crypto.randomInt;
        crypto.randomInt = () => 42;
        try { assert.equal(crearCodigo(), '000042'); } finally { crypto.randomInt = original; }
    });

    it('solo vale un código de exactamente 6 dígitos', () => {
        assert.equal(formatoDeCodigo('123456'), true);
        assert.equal(formatoDeCodigo(' 123456 '), true);
        for (const malo of ['12345', '1234567', 'abcdef', '12 456', '', null, undefined, 123456]) assert.equal(formatoDeCodigo(malo), false, String(malo));
    });

    it('la huella depende del código, de la cuenta y del secreto del servidor', () => {
        const base = huellaDeCodigo(7, '123456', 'secreto');
        assert.match(base, /^[0-9a-f]{64}$/);
        assert.equal(huellaDeCodigo(7, ' 123456 ', 'secreto'), base, 'ignora los espacios');
        for (const otra of [huellaDeCodigo(8, '123456', 'secreto'), huellaDeCodigo(7, '654321', 'secreto'), huellaDeCodigo(7, '123456', 'otro')]) assert.notEqual(otra, base);
        assert.ok(!base.includes('123456'), 'la huella no contiene el código');
    });

    it('compara huellas sin aceptar vacías ni de otro largo', () => {
        const h = huellaDeCodigo(1, '111111', 's');
        assert.equal(huellasIguales(h, h), true);
        assert.equal(huellasIguales(h, huellaDeCodigo(1, '111112', 's')), false);
        assert.equal(huellasIguales(h, h.slice(0, 10)), false);
        assert.equal(huellasIguales('', ''), false);
        assert.equal(huellasIguales(undefined, h), false);
    });

    it('un código solo está vigente si no se usó, no venció y le quedan intentos', () => {
        assert.equal(estadoDeCodigo({ vencido: false, intentos: 0, usado: false }), 'vigente');
        assert.equal(estadoDeCodigo({ vencido: false, intentos: MAX_INTENTOS - 1, usado: false }), 'vigente');
        assert.equal(estadoDeCodigo({ vencido: false, intentos: MAX_INTENTOS, usado: false }), 'agotado');
        assert.equal(estadoDeCodigo({ vencido: true, intentos: 0, usado: false }), 'vencido');
        assert.equal(estadoDeCodigo({ vencido: false, intentos: 0, usado: true }), 'usado');
        assert.equal(estadoDeCodigo({ vencido: true, intentos: MAX_INTENTOS, usado: true }), 'usado');
    });

    it('hay que esperar un minuto entre un pedido y otro', () => {
        assert.equal(debeEsperar(0), true);
        assert.equal(debeEsperar(ESPERA_SEGUNDOS - 1), true);
        assert.equal(debeEsperar(ESPERA_SEGUNDOS), false);
        assert.equal(debeEsperar(3600), false);
    });

    it('el correo lleva el código y el nombre sin dejar pasar HTML', () => {
        const c = armarCorreoCodigo({ nombre: 'Ana <b>Paz</b>', codigo: '012345' });
        assert.match(c.texto, /012345/);
        assert.match(c.html, /012345/);
        assert.ok(!c.html.includes('<b>Paz</b>'), 'el nombre se escapa');
        assert.match(c.html, /Ana &lt;b&gt;Paz&lt;\/b&gt;/);
        assert.match(c.texto, /15 minutos/);
        assert.match(c.asunto, /restablecer la contraseña/);
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API de recuperación de contraseña', { skip }, () => {
    let server, base, db, tokenAdmin, userId, enviados, ultimo, fallaElEnvio;
    const usuario = `rec-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
    const claveVieja = `Aa1!${crypto.randomBytes(8).toString('hex')}`;
    const claveNueva = `Bb2!${crypto.randomBytes(8).toString('hex')}`;

    async function api(method, path, { token, body } = {}) {
        const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const pedir = (u = usuario) => api('POST', '/api/auth/recuperar', { body: { usuario: u } });
    const restablecer = (codigo, password = claveNueva, u = usuario) => api('POST', '/api/auth/restablecer', { body: { usuario: u, codigo, password } });
    const login = (password) => api('POST', '/api/auth/login', { body: { username: usuario, password } });
    // El último correo que salió (de cualquier prueba anterior): el código que la familia tiene a mano
    const ultimoCodigo = () => ultimo.texto.match(/es: (\d{6})/)[1];
    // Permite pedir otro código enseguida: la espera de un minuto se prueba aparte
    const sinEspera = () => db.query("UPDATE recuperaciones_password SET creado_en = CURRENT_TIMESTAMP - interval '5 minutes' WHERE user_id = $1", [userId]);
    const guardado = async () => (await db.query('SELECT * FROM recuperaciones_password WHERE user_id = $1', [userId])).rows[0];

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = (await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).data.token;
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Recupera', username: usuario, password: claveVieja, rol: 'padre' } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        userId = r.data.id;
    });

    beforeEach(() => {
        enviados = [];
        fallaElEnvio = false;
        usarProveedor({
            async enviar(mensaje) {
                if (fallaElEnvio) throw new Error('el proveedor no responde');
                enviados.push(mensaje);
                ultimo = mensaje;
                return { id: 'falso' };
            },
        });
    });

    after(async () => {
        usarProveedor(undefined);
        await api('DELETE', `/api/auth/users/${userId}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        await db.end();
    });

    it('al pedir el código llega por correo, y la respuesta es la misma exista o no la cuenta', async () => {
        const existente = await pedir();
        assert.equal(existente.status, 200);
        assert.equal(existente.data.message, MENSAJE_PEDIDO);
        assert.equal(enviados.length, 1);
        assert.equal(enviados[0].para, usuario);
        assert.match(ultimoCodigo(), /^\d{6}$/);
        assert.match(enviados[0].texto, /Familia Recupera/);

        for (const otro of ['nadie@example.com', 'admin', 'no es un correo', '']) {
            const r = await pedir(otro);
            assert.equal(r.status, otro === '' ? 400 : 200, otro);
            if (otro !== '') assert.equal(r.data.message, MENSAJE_PEDIDO, `${otro}: no revela si existe`);
        }
        assert.equal(enviados.length, 1, 'a las cuentas que no existen o no tienen correo no se les envía nada');
        const fila = await guardado();
        assert.notEqual(fila.huella, ultimoCodigo(), 'solo se guarda la huella');
        assert.ok(!JSON.stringify(fila).includes(ultimoCodigo()));
    });

    it('no se manda otro código antes de un minuto, y después sí (y reemplaza al anterior)', async () => {
        await pedir();
        assert.equal(enviados.length, 0, 'recién se envió uno');
        const anterior = (await guardado()).huella;
        await sinEspera();
        await pedir();
        assert.equal(enviados.length, 1);
        assert.notEqual((await guardado()).huella, anterior, 'el código nuevo reemplaza al anterior');
    });

    it('un código equivocado se rechaza y se cuenta; con 5 errores el código se agota aunque después se acierte', async () => {
        const bueno = ultimoCodigo();
        const malo = bueno === '000000' ? '111111' : '000000';
        for (let i = 1; i <= MAX_INTENTOS; i++) {
            const r = await restablecer(malo);
            assert.equal(r.status, 400);
            assert.equal(r.data.message, MENSAJE_CODIGO_INVALIDO);
            assert.equal((await guardado()).intentos, i);
        }
        const tarde = await restablecer(bueno);
        assert.equal(tarde.status, 400, 'agotado: ni el correcto sirve');
        assert.equal((await login(claveVieja)).status, 200, 'la contraseña no cambió');
        await sinEspera();
        await pedir();
        assert.equal((await guardado()).intentos, 0, 'un código nuevo empieza de cero');
    });

    it('valida la contraseña nueva y el formato del código sin gastar el código', async () => {
        const codigo = ultimoCodigo();
        assert.equal((await restablecer(codigo, 'corta')).status, 400);
        assert.equal((await restablecer(codigo, 'sinmayuscula1!')).status, 400);
        assert.equal((await restablecer('12345')).status, 400);
        assert.equal((await restablecer('abcdef')).status, 400);
        assert.equal((await api('POST', '/api/auth/restablecer', { body: { usuario, codigo } })).status, 400, 'falta la contraseña');
        const fila = await guardado();
        assert.equal(fila.intentos, 0, 'los datos mal formados no cuentan como intento');
        assert.equal(fila.usado, false);
    });

    it('un código vencido no sirve', async () => {
        const codigo = ultimoCodigo();
        await db.query("UPDATE recuperaciones_password SET vence_en = CURRENT_TIMESTAMP - interval '1 minute' WHERE user_id = $1", [userId]);
        const r = await restablecer(codigo);
        assert.equal(r.status, 400);
        assert.equal(r.data.message, MENSAJE_CODIGO_INVALIDO);
        assert.equal((await login(claveVieja)).status, 200);
        await sinEspera();
        await pedir();
    });

    it('con el código correcto cambia la contraseña: la vieja deja de servir, la nueva entra y el código no se reutiliza', async () => {
        const codigo = ultimoCodigo();
        const r = await restablecer(codigo);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal((await login(claveVieja)).status, 401);
        const nuevo = await login(claveNueva);
        assert.equal(nuevo.status, 200);
        assert.equal(nuevo.data.user.username, usuario);
        assert.equal((await guardado()).usado, true);
        assert.equal((await restablecer(codigo, `Cc3!${crypto.randomBytes(6).toString('hex')}`)).status, 400, 'un código se usa una sola vez');
        assert.equal((await login(claveNueva)).status, 200, 'el intento repetido no cambió nada');
        const stored = (await db.query('SELECT password FROM users WHERE id = $1', [userId])).rows[0].password;
        assert.ok(stored.startsWith('$2'), 'la contraseña se guarda con hash');
    });

    it('el código de una cuenta no sirve en otra', async () => {
        await sinEspera();
        await pedir();
        const codigo = ultimoCodigo();
        const r = await restablecer(codigo, claveNueva, 'padre');
        assert.equal(r.status, 400);
        assert.equal((await api('POST', '/api/auth/login', { body: { username: 'padre', password: 'padre123' } })).status, 200, 'la otra cuenta quedó intacta');
        assert.equal((await restablecer(codigo, claveNueva, 'nadie@example.com')).status, 400);
    });

    it('si el proveedor falla igual se responde lo mismo (no se revela la cuenta), y sin proveedor es un 503', async () => {
        await sinEspera();
        fallaElEnvio = true;
        const r = await pedir();
        assert.equal(r.status, 200);
        assert.equal(r.data.message, MENSAJE_PEDIDO);
        usarProveedor(null);
        const sin = await pedir();
        assert.equal(sin.status, 503);
        assert.match(sin.data.message, /no está disponible/);
    });
});
