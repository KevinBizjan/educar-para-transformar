// Correos automáticos (HU10): calendario, mensajes, proveedor y envío contra un PostgreSQL REAL.
// El proveedor de correo es siempre uno falso: las pruebas nunca llaman a Resend. La parte de la API y del envío solo
// corre si DATABASE_URL apunta a localhost.
const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
    TIPOS, feriadosDe, ultimoDiaHabil, periodoDe, tareasDelDia, esCorreo, escapar, armarCorreoFactura, armarAvisoDeuda,
} = require('../src/utils/correos');
const { CorreoError, crearProveedorResend, proveedorDesdeEntorno, usarProveedor, REMITENTE_POR_DEFECTO } = require('../src/services/correo');

describe('Correos: calendario', () => {
    it('el último día hábil salta fines de semana y feriados', () => {
        assert.equal(ultimoDiaHabil(2026, 11), '2026-11-30', 'lunes');
        assert.equal(ultimoDiaHabil(2026, 10), '2026-10-30', 'el 31 es sábado');
        assert.equal(ultimoDiaHabil(2026, 5), '2026-05-29', 'el 31 es domingo');
        assert.equal(ultimoDiaHabil(2026, 2), '2026-02-27', 'el 28 es sábado');
        assert.equal(ultimoDiaHabil(2028, 2), '2028-02-29', 'año bisiesto');
        assert.equal(ultimoDiaHabil(2026, 10, new Set(['2026-10-30'])), '2026-10-29', 'feriado');
        assert.equal(ultimoDiaHabil(2026, 10, new Set(['2026-10-30', '2026-10-29'])), '2026-10-28', 'dos feriados seguidos');
        assert.equal(ultimoDiaHabil(2026, 12), '2026-12-31', 'jueves');
    });

    it('lee los feriados de la configuración e ignora lo inválido', () => {
        assert.deepEqual([...feriadosDe('2026-12-08, 2026-12-25,mal,2026-02-31')], ['2026-12-08', '2026-12-25']);
        assert.equal(feriadosDe(undefined).size, 0);
        assert.equal(feriadosDe('').size, 0);
    });

    it('la factura toca desde el último día hábil y el aviso el día 20 (con dos días de gracia)', () => {
        assert.deepEqual(tareasDelDia('2026-11-30'), ['factura_fin_de_mes']);
        assert.deepEqual(tareasDelDia('2026-11-29'), [], 'domingo, todavía no es el último día hábil');
        assert.deepEqual(tareasDelDia('2026-10-30'), ['factura_fin_de_mes']);
        assert.deepEqual(tareasDelDia('2026-10-31'), ['factura_fin_de_mes'], 'si ese día falló, se envía lo que quedó pendiente del mes');
        assert.deepEqual(tareasDelDia('2026-10-29', new Set(['2026-10-30'])), ['factura_fin_de_mes'], 'el 30 es feriado');
        assert.deepEqual(tareasDelDia('2026-11-19'), []);
        for (const dia of ['20', '21', '22']) assert.deepEqual(tareasDelDia(`2026-11-${dia}`), ['aviso_deuda'], dia);
        assert.deepEqual(tareasDelDia('2026-11-23'), []);
        assert.deepEqual(tareasDelDia('2026-11-10'), []);
        assert.equal(periodoDe('2026-11-30'), '2026-11');
        assert.deepEqual(TIPOS, ['factura_fin_de_mes', 'aviso_deuda']);
    });

    it('solo un usuario con forma de correo recibe mensajes', () => {
        assert.equal(esCorreo('familia@correo.com'), true);
        assert.equal(esCorreo('  familia@correo.com '), true);
        for (const no of ['padre', 'sin arroba.com', 'a@b', '@correo.com', '', null, undefined, 5]) assert.equal(esCorreo(no), false, String(no));
    });
});

describe('Correos: mensajes', () => {
    const factura = { referencia: 'EPT-20261130-ABC234', total: 27345.67, items: [{ descripcion: 'Cuota de Marzo 2026 - Paz, Ana', monto: 15000 }, { descripcion: 'Comedor mensual (Marzo 2026) - Paz, Ana', monto: 12345.67 }] };

    it('la factura de fin de mes lleva el período, la referencia, el total, los ítems y cómo pagar', () => {
        const m = armarCorreoFactura({ nombre: 'Familia Paz', factura, datosBancarios: { titular: 'Escuela', alias: 'escuela.pagos' }, hoy: '2026-11-30' });
        assert.equal(m.asunto, 'Factura de Noviembre 2026 · EPT-20261130-ABC234');
        for (const parte of ['Familia Paz', 'EPT-20261130-ABC234', '$27.345,67', 'Cuota de Marzo 2026 - Paz, Ana', 'Alias: escuela.pagos', 'No se aceptan pagos en efectivo']) {
            assert.ok(m.html.includes(parte), `html: ${parte}`);
            assert.ok(m.texto.includes(parte), `texto: ${parte}`);
        }
        assert.match(armarCorreoFactura({ nombre: 'x', factura, datosBancarios: null, hoy: '2026-11-30' }).texto, /Consultá los datos bancarios/);
    });

    it('el aviso lista lo pendiente con su vencimiento, el total y qué hacer', () => {
        const items = [
            { descripcion: 'Cuota de Marzo 2026 - Paz, Ana', monto: 10000, estado: 'Vencida', vencimiento: '2026-03-10', en_factura: null },
            { descripcion: 'Cuota de Noviembre 2026 - Paz, Ana', monto: 15000.5, estado: 'Pendiente', vencimiento: '2026-11-25', en_factura: 'EPT-20261030-XYZ234' },
        ];
        const m = armarAvisoDeuda({ nombre: 'Familia Paz', items, hoy: '2026-11-20' });
        assert.equal(m.asunto, 'Aviso de pagos pendientes · Noviembre 2026');
        assert.equal(m.total, 25000.5);
        for (const parte of ['venció el 10/03/2026', 'vence el 25/11/2026', 'factura EPT-20261030-XYZ234', '$25.000,50', 'Total pendiente']) {
            assert.ok(m.html.includes(parte), `html: ${parte}`);
            assert.ok(m.texto.includes(parte), `texto: ${parte}`);
        }
    });

    it('los datos de la familia no pueden inyectar HTML', () => {
        assert.equal(escapar('<img src=x onerror=alert(1)> & "comillas" \'simples\''), '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;comillas&quot; &#39;simples&#39;');
        const m = armarCorreoFactura({ nombre: '<script>alert(1)</script>', factura: { ...factura, items: [{ descripcion: '<b>x</b>', monto: 1 }] }, datosBancarios: null, hoy: '2026-11-30' });
        assert.ok(!m.html.includes('<script>') && !m.html.includes('<b>x</b>'));
        assert.ok(m.html.includes('&lt;script&gt;'));
    });
});

describe('Correos: proveedor (Resend)', () => {
    const respuesta = (estado, datos) => ({ ok: estado < 400, status: estado, json: async () => datos });
    const proveedorCon = (respuestas, extra = {}) => {
        const llamadas = [];
        const fetchFn = async (url, opciones) => { llamadas.push({ url, opciones, cuerpo: JSON.parse(opciones.body) }); return respuestas.shift(); };
        return { llamadas, proveedor: crearProveedorResend({ clave: 'clave-de-prueba', fetchFn, pausaReintentoMs: 0, ...extra }) };
    };

    it('manda el correo con la clave, el remitente y los adjuntos en base64', async () => {
        const { proveedor, llamadas } = proveedorCon([respuesta(200, { id: 'abc-123' })]);
        const r = await proveedor.enviar({ para: 'familia@correo.com', asunto: 'Hola', html: '<p>x</p>', texto: 'x', adjuntos: [{ nombre: 'f.pdf', contenido: Buffer.from('%PDF-prueba') }] });
        assert.deepEqual(r, { id: 'abc-123' });
        const [llamada] = llamadas;
        assert.equal(llamada.url, 'https://api.resend.com/emails');
        assert.equal(llamada.opciones.method, 'POST');
        assert.equal(llamada.opciones.headers.Authorization, 'Bearer clave-de-prueba');
        assert.deepEqual([llamada.cuerpo.from, llamada.cuerpo.to, llamada.cuerpo.subject], [REMITENTE_POR_DEFECTO, ['familia@correo.com'], 'Hola']);
        assert.deepEqual(llamada.cuerpo.attachments, [{ filename: 'f.pdf', content: Buffer.from('%PDF-prueba').toString('base64') }]);
    });

    it('con redirección todo llega a una sola casilla y el asunto dice a quién iba', async () => {
        const { proveedor, llamadas } = proveedorCon([respuesta(200, { id: '1' })], { redirigirA: 'prueba@correo.com' });
        assert.equal(proveedor.redirigeA, 'prueba@correo.com');
        await proveedor.enviar({ para: 'familia@correo.com', asunto: 'Aviso', html: 'h', texto: 't' });
        assert.deepEqual(llamadas[0].cuerpo.to, ['prueba@correo.com']);
        assert.equal(llamadas[0].cuerpo.subject, '[Para familia@correo.com] Aviso');
        assert.equal('attachments' in llamadas[0].cuerpo, false, 'sin adjuntos no se manda el campo');
    });

    it('reintenta una vez ante el límite de pedidos (429) y informa los demás errores', async () => {
        const { proveedor, llamadas } = proveedorCon([respuesta(429, {}), respuesta(200, { id: 'ok' })]);
        assert.deepEqual(await proveedor.enviar({ para: 'a@b.co', asunto: 's', html: 'h', texto: 't' }), { id: 'ok' });
        assert.equal(llamadas.length, 2);
        const doble = proveedorCon([respuesta(429, {}), respuesta(429, { message: 'Too many requests' })]);
        await assert.rejects(() => doble.proveedor.enviar({ para: 'a@b.co', asunto: 's', html: 'h', texto: 't' }), (e) => e instanceof CorreoError && /429/.test(e.message));
        const prohibido = proveedorCon([respuesta(403, { message: 'You can only send testing emails to your own email address' })]);
        await assert.rejects(() => prohibido.proveedor.enviar({ para: 'a@b.co', asunto: 's', html: 'h', texto: 't' }), (e) => e instanceof CorreoError && /403.*own email/.test(e.message));
    });

    it('si no hay conexión, el error es de correo y no revela la clave', async () => {
        const proveedor = crearProveedorResend({ clave: 'clave-secreta-xyz', fetchFn: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
        await assert.rejects(() => proveedor.enviar({ para: 'a@b.co', asunto: 's', html: 'h', texto: 't' }), (e) => e instanceof CorreoError && !e.message.includes('clave-secreta-xyz'));
    });

    it('sin la clave en la configuración, el envío no está disponible', () => {
        assert.equal(proveedorDesdeEntorno({}), null);
        assert.ok(proveedorDesdeEntorno({ RESEND_API_KEY: 'k' }));
        assert.equal(proveedorDesdeEntorno({ RESEND_API_KEY: 'k', MAIL_REDIRIGIR_A: 'x@y.co' }).redirigeA, 'x@y.co');
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('Envío automático de correos (HU10)', { skip }, () => {
    let server, base, db, job, tokenAdmin, tokenPadre;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [], padres: [] };
    const F = {};

    const crearProveedorFalso = () => {
        const falso = {
            enviados: [], falla: null, redirigeA: null,
            async enviar(correo) {
                if (falso.falla) throw new CorreoError(falso.falla);
                falso.enviados.push(correo);
                return { id: `id-${falso.enviados.length}` };
            },
        };
        return falso;
    };
    let proveedor;

    async function api(method, path, { token, body, cabeceras } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cabeceras || {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    let seq = 0;
    // DNI al azar: los archivos de prueba corren a la vez en procesos distintos y un contador por hora podría chocar
    const dni = () => 'T' + require('node:crypto').randomBytes(5).toString('hex') + String(++seq);
    const unico = Date.now();

    const crearPadre = async (username, nombre) => {
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre, username, password: 'Correos123!', rol: 'padre' } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        ids.padres.push(r.data.id);
        return r.data.id;
    };
    const crearHijo = async (apellido, tutorId) => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('Cor', $1, $2, '2015-05-05', $3, $4, 'Activo') RETURNING id`, [apellido, dni(), F.cursoId, tutorId])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const crearCuota = async (mes, anio, monto) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id', [F.nivelId, monto, mes, anio, `${anio}-${String(mes).padStart(2, '0')}-10`])).rows[0].id;
        ids.cuotas.push(id);
        return id;
    };
    const ejecutar = (opciones = {}) => job.ejecutarTareas({ proveedor, pausaMs: 0, padreIds: ids.padres, ...opciones });
    const auditoria = async (tipo, periodo, usuarioId) => (await db.query('SELECT * FROM correos_enviados WHERE tipo = $1 AND periodo = $2 AND usuario_id = $3 ORDER BY id', [tipo, periodo, usuarioId])).rows;
    const facturasDe = async (usuarioId) => (await db.query('SELECT id, estado, total FROM facturas WHERE tutor_id = $1 ORDER BY id', [usuarioId])).rows;

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        job = require('../src/services/correosJob');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');
        tokenPadre = await login('padre', 'padre123');

        F.nivelId = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU10 ${unico}`])).rows[0].id;
        F.cursoId = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [F.nivelId, 'A'])).rows[0].id;
        ids.niveles.push(F.nivelId);
        ids.cursos.push(F.cursoId);
        F.conCorreo = await crearPadre(`hu10-${unico}@prueba.test`, 'Familia Con Correo');
        F.sinCorreo = await crearPadre(`hu10sin${unico}`, 'Familia Sin Correo');
        F.hijoA = await crearHijo('Alfa', F.conCorreo);
        F.hijoB = await crearHijo('Beta', F.sinCorreo);
        F.marzo = await crearCuota(3, 2019, 15000);
        F.abril = await crearCuota(4, 2019, 12345.67);
    });

    beforeEach(() => { proveedor = crearProveedorFalso(); usarProveedor(proveedor); });

    after(async () => {
        mock.restoreAll();
        usarProveedor(undefined);
        delete process.env.CRON_SECRET;
        if (ids.padres.length) {
            await db.query('DELETE FROM correos_enviados WHERE usuario_id = ANY($1)', [ids.padres]);
            await db.query('DELETE FROM facturas WHERE tutor_id = ANY($1)', [ids.padres]);
        }
        await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        for (const id of ids.padres) await api('DELETE', `/api/auth/users/${id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('simular informa a quién se le enviaría y no escribe nada', async () => {
        const r = await ejecutar({ hoy: '2026-11-30', simular: true });
        assert.equal(r.simulado, true);
        assert.deepEqual(r.tareas, ['factura_fin_de_mes']);
        assert.deepEqual(r.resultados.map((x) => [x.usuario.startsWith('hu10-'), x.resultado, x.sinCorreo]), [[true, 'Se enviaría', false], [false, 'Se enviaría', true]]);
        assert.equal(proveedor.enviados.length, 0);
        assert.equal((await facturasDe(F.conCorreo)).length, 0, 'no se emitió ninguna factura');
        assert.equal((await auditoria('factura_fin_de_mes', '2026-11', F.conCorreo)).length, 0);
    });

    it('el último día hábil emite la factura de cada familia y envía el correo con el PDF adjunto', async () => {
        const r = await ejecutar({ hoy: '2026-11-30' });
        assert.deepEqual(r.conteo, { Enviado: 1, Omitido: 1 });

        assert.equal(proveedor.enviados.length, 1);
        const correo = proveedor.enviados[0];
        assert.equal(correo.para, `hu10-${unico}@prueba.test`);
        const [factura] = await facturasDe(F.conCorreo);
        assert.equal(factura.estado, 'Pendiente');
        assert.equal(factura.total, 15000 + 12345.67);
        const referencia = (await db.query('SELECT referencia FROM facturas WHERE id = $1', [factura.id])).rows[0].referencia;
        assert.ok(correo.asunto.includes(referencia));
        assert.equal(correo.adjuntos.length, 1);
        assert.equal(correo.adjuntos[0].nombre, `factura-${referencia}.pdf`);
        assert.equal(correo.adjuntos[0].contenido.subarray(0, 5).toString(), '%PDF-');
        assert.ok(correo.html.includes('$27.345,67') && correo.html.includes('Cuota de Marzo 2019'));

        const [enviado] = await auditoria('factura_fin_de_mes', '2026-11', F.conCorreo);
        assert.deepEqual([enviado.estado, enviado.destinatario, enviado.proveedor_id, enviado.factura_id], ['Enviado', `hu10-${unico}@prueba.test`, 'id-1', factura.id]);

        const [omitido] = await auditoria('factura_fin_de_mes', '2026-11', F.sinCorreo);
        assert.equal(omitido.estado, 'Omitido');
        assert.match(omitido.detalle, /no tiene un correo válido/);
        assert.equal((await facturasDe(F.sinCorreo)).length, 1, 'la factura se emitió igual: la familia la ve en la app');
    });

    it('volver a correr el mismo período no repite nada', async () => {
        const antes = (await facturasDe(F.conCorreo)).length;
        const r = await ejecutar({ hoy: '2026-11-30' });
        assert.deepEqual(r.conteo, { 'Ya enviado': 2 });
        assert.equal(proveedor.enviados.length, 0);
        assert.equal((await facturasDe(F.conCorreo)).length, antes);
        assert.equal((await auditoria('factura_fin_de_mes', '2026-11', F.conCorreo)).length, 1);
    });

    it('el día 20 avisa a quien tiene pagos pendientes, y a quien ya pagó y espera la revisión no', async () => {
        const r = await ejecutar({ hoy: '2026-12-20' });
        assert.deepEqual(r.tareas, ['aviso_deuda']);
        assert.deepEqual(r.conteo, { Enviado: 1, Omitido: 1 });
        const correo = proveedor.enviados[0];
        assert.ok(correo.asunto.startsWith('Aviso de pagos pendientes · Diciembre 2026'));
        assert.ok(correo.html.includes('Cuota de Abril 2019') && correo.html.includes('venció el 10/04/2019'));
        assert.ok(correo.html.includes('$27.345,67'));
        assert.equal(correo.adjuntos, undefined, 'el aviso no lleva adjuntos');

        // Con comprobante subido, la factura queda "En revisión": ya pagó, no es deuda
        await db.query("UPDATE facturas SET estado = 'En revision' WHERE tutor_id = ANY($1)", [ids.padres]);
        proveedor.enviados.length = 0;
        const sinDeuda = await ejecutar({ hoy: '2027-01-21', tipos: ['aviso_deuda'] });
        assert.deepEqual(sinDeuda.conteo, { 'Sin deuda': 2 });
        assert.equal(proveedor.enviados.length, 0);
        await db.query("UPDATE facturas SET estado = 'Pendiente' WHERE tutor_id = ANY($1)", [ids.padres]);
    });

    it('un fallo del proveedor queda registrado, y al reintentar se reutiliza la factura sin emitir otra', async () => {
        await crearCuota(5, 2019, 9999.99); // algo nuevo para facturar en este período
        proveedor.falla = 'El servicio de correo respondió 403: solo se puede enviar a tu propio correo';
        const falla = await ejecutar({ hoy: '2027-01-29' });
        assert.deepEqual(falla.conteo, { Error: 1, Omitido: 1 });
        const [error] = await auditoria('factura_fin_de_mes', '2027-01', F.conCorreo);
        assert.equal(error.estado, 'Error');
        assert.match(error.detalle, /403/);
        const facturasTrasFallo = await facturasDe(F.conCorreo);

        proveedor.falla = null;
        const ok = await ejecutar({ hoy: '2027-01-29' });
        assert.equal(ok.resultados.find((x) => x.usuario.startsWith('hu10-')).resultado, 'Enviado');
        const filas = await auditoria('factura_fin_de_mes', '2027-01', F.conCorreo);
        assert.deepEqual(filas.map((f) => f.estado), ['Error', 'Enviado'], 'el error queda en el historial');
        assert.equal(filas[1].factura_id, filas[0].factura_id, 'se reenvió la misma factura');
        assert.equal((await facturasDe(F.conCorreo)).length, facturasTrasFallo.length, 'no se emitió otra');
        assert.equal(proveedor.enviados.length, 1);
        assert.equal(proveedor.enviados[0].adjuntos[0].contenido.subarray(0, 5).toString(), '%PDF-');
    });

    it('con el modo de prueba el registro aclara que se redirigió', async () => {
        await crearCuota(6, 2019, 5000);
        proveedor.redirigeA = 'prueba@correo.com';
        await ejecutar({ hoy: '2027-02-26' });
        const [fila] = await auditoria('factura_fin_de_mes', '2027-02', F.conCorreo);
        assert.equal(fila.estado, 'Enviado');
        assert.match(fila.detalle, /Redirigido a prueba@correo\.com/);
        assert.equal(fila.destinatario, `hu10-${unico}@prueba.test`, 'se registra a quién iba originalmente');
    });

    it('dos ejecuciones simultáneas no duplican los correos', async () => {
        await crearCuota(7, 2019, 4000);
        const resultados = await Promise.allSettled([ejecutar({ hoy: '2027-03-31' }), ejecutar({ hoy: '2027-03-31' }), ejecutar({ hoy: '2027-03-31' })]);
        const enCurso = resultados.filter((r) => r.status === 'rejected');
        assert.ok(enCurso.every((r) => r.reason.estado === 409 && /en curso/.test(r.reason.message)));
        assert.equal(proveedor.enviados.filter((c) => c.para === `hu10-${unico}@prueba.test`).length, 1, 'un solo correo por familia');
        assert.equal((await auditoria('factura_fin_de_mes', '2027-03', F.conCorreo)).length, 1);
    });

    it('sin el proveedor configurado no se envía, pero simular sigue funcionando', async () => {
        await assert.rejects(() => ejecutar({ hoy: '2027-04-30', proveedor: null }), (e) => e.estado === 503 && /RESEND_API_KEY/.test(e.message));
        assert.equal((await ejecutar({ hoy: '2027-04-30', proveedor: null, simular: true })).simulado, true);
    });

    it('el disparador diario y la Dirección pueden ejecutar; cada uno con sus permisos', async () => {
        const ejecutarFalso = mock.method(job, 'ejecutarTareas', async (opciones) => ({ recibido: opciones }));
        // Sin sesión ni secreto
        assert.equal((await api('POST', '/api/correos/ejecutar')).status, 403);
        assert.equal((await api('POST', '/api/correos/ejecutar', { token: tokenPadre })).status, 403);
        // El secreto del disparador
        delete process.env.CRON_SECRET;
        assert.equal((await api('POST', '/api/correos/ejecutar', { cabeceras: { 'x-cron-secret': 'cualquiera' } })).status, 403, 'sin CRON_SECRET configurado nadie entra con un secreto');
        process.env.CRON_SECRET = 'secreto-de-prueba-largo-0123456789';
        assert.equal((await api('POST', '/api/correos/ejecutar', { cabeceras: { 'x-cron-secret': 'otro' } })).status, 403);
        assert.equal((await api('POST', '/api/correos/ejecutar', { cabeceras: { 'x-cron-secret': '' } })).status, 403);
        const cron = await api('POST', '/api/correos/ejecutar', { cabeceras: { 'x-cron-secret': 'secreto-de-prueba-largo-0123456789' }, body: { fecha: '2026-01-01', tipos: ['aviso_deuda'], simular: true } });
        assert.equal(cron.status, 200);
        assert.deepEqual(cron.data.recibido, {}, 'el disparador no puede elegir fecha, tipos ni simular');
        // El administrador sí
        const admin = await api('POST', '/api/correos/ejecutar', { token: tokenAdmin, body: { fecha: '2026-11-30', tipos: ['factura_fin_de_mes'], simular: true, padres: [F.conCorreo] } });
        assert.equal(admin.status, 200);
        assert.deepEqual(admin.data.recibido, { hoy: '2026-11-30', tipos: ['factura_fin_de_mes'], simular: true, padreIds: [F.conCorreo] });
        assert.deepEqual((await api('POST', '/api/correos/ejecutar', { token: tokenAdmin })).data.recibido, { simular: false });
        assert.equal(ejecutarFalso.mock.callCount(), 3);
        // Validaciones
        for (const mala of [{ fecha: '2026-02-31' }, { tipos: ['otro'] }, { tipos: 'aviso_deuda' }, { padres: [] }, { padres: ['x'] }, { padres: [0] }]) {
            assert.equal((await api('POST', '/api/correos/ejecutar', { token: tokenAdmin, body: mala })).status, 400, JSON.stringify(mala));
        }
        mock.restoreAll();
        delete process.env.CRON_SECRET;
    });

    it('la Dirección consulta la auditoría con filtros, y nadie más', async () => {
        const todo = await api('GET', '/api/correos?limite=500', { token: tokenAdmin });
        assert.equal(todo.status, 200);
        const mios = todo.data.correos.filter((c) => c.familia && c.familia.startsWith('Familia Con Correo'));
        assert.ok(mios.length >= 3);
        assert.deepEqual(Object.keys(mios[0]).sort(), ['asunto', 'creado_en', 'destinatario', 'detalle', 'estado', 'factura', 'factura_id', 'familia', 'id', 'periodo', 'proveedor_id', 'tipo']);
        const errores = await api('GET', '/api/correos?estado=Error', { token: tokenAdmin });
        assert.ok(errores.data.correos.length >= 1 && errores.data.correos.every((c) => c.estado === 'Error'));
        const avisos = await api('GET', '/api/correos?tipo=aviso_deuda', { token: tokenAdmin });
        assert.ok(avisos.data.correos.every((c) => c.tipo === 'aviso_deuda'));
        assert.equal((await api('GET', '/api/correos?limite=1', { token: tokenAdmin })).data.correos.length, 1);
        assert.equal((await api('GET', '/api/correos?tipo=otro', { token: tokenAdmin })).status, 400);
        assert.equal((await api('GET', '/api/correos?estado=otro', { token: tokenAdmin })).status, 400);
        for (const t of [tokenPadre, await login('docente', 'docente123'), null]) assert.equal((await api('GET', '/api/correos', { token: t })).status, 403);
    });
});
