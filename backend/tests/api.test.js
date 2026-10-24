// Pruebas de integración de la API contra un PostgreSQL REAL (el de la CI o uno local).
// Por seguridad NO corren contra la base de Supabase: solo si DATABASE_URL apunta a
// localhost, porque las pruebas crean datos (cursos, alumnos, pagos, reservas).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dbUrl = process.env.DATABASE_URL || '';
const esBaseLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl);
const skip = esBaseLocal
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API Educar para Transformar', { skip }, () => {
    let server, base, db;
    const tokens = {};
    const users = {};

    // Días distintos en cada corrida: evita choques si la base ya tiene datos de otra corrida.
    const diasDesde = (anio, tope) => new Date(Date.UTC(anio, 0, 1) + (Date.now() % tope) * 86400000).toISOString().slice(0, 10);
    let seq = 0;
    const dniUnico = () => String(Date.now()).slice(-7) + String(++seq).padStart(2, '0');

    async function http(method, path, { token, body } = {}) {
        const res = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        return res;
    }
    async function api(method, path, opts) {
        const res = await http(method, path, opts);
        let data = null;
        try { data = await res.json(); } catch { /* respuesta sin JSON */ }
        return { status: res.status, data };
    }
    async function login(username, password) {
        const r = await api('POST', '/api/auth/login', { body: { username, password } });
        assert.equal(r.status, 200, `login de ${username} falló: ${JSON.stringify(r.data)}`);
        tokens[username] = r.data.token;
        users[username] = r.data.user;
    }
    const alumnoBase = (extra = {}) => ({
        nombre: 'Prueba', apellido: 'Automatica', dni: dniUnico(), fecha_nacimiento: '2016-01-01',
        domicilio: 'Calle 123', telefono: '3624000000', email: 'prueba@mail.com', ...extra
    });

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        for (const [u, p] of [['admin', 'admin123'], ['docente', 'docente123'], ['alumno', 'alumno123'], ['padre', 'padre123']]) {
            await login(u, p);
        }
    });

    after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db) await db.end();
    });

    describe('Autenticación y sesión (RF16, RNF01, RNF04)', () => {
        it('el health check responde 200', async () => {
            const r = await api('GET', '/api/health');
            assert.equal(r.status, 200);
        });

        it('rechaza credenciales vacías antes de consultar la base', async () => {
            const r = await api('POST', '/api/auth/login', { body: { username: '', password: '' } });
            assert.equal(r.status, 400);
        });

        it('rechaza una contraseña incorrecta', async () => {
            const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'incorrecta' } });
            assert.equal(r.status, 401);
        });

        it('el token lleva el rol y vence a los 30 minutos', () => {
            const payload = JSON.parse(Buffer.from(tokens.admin.split('.')[1], 'base64url').toString());
            assert.equal(payload.rol, 'admin');
            assert.equal(payload.exp - payload.iat, 30 * 60);
        });
    });

    describe('Control de acceso por rol (RBAC)', () => {
        it('sin token no se accede a rutas protegidas', async () => {
            const r = await api('GET', '/api/academico/alumnos');
            assert.equal(r.status, 403);
        });

        it('un padre no puede listar todos los alumnos', async () => {
            const r = await api('GET', '/api/academico/alumnos', { token: tokens.padre });
            assert.equal(r.status, 403);
        });

        it('un docente no puede dar de alta alumnos', async () => {
            const r = await api('POST', '/api/academico/alumnos', { token: tokens.docente, body: alumnoBase() });
            assert.equal(r.status, 403);
        });

        it('un alumno no puede registrar pagos', async () => {
            const r = await api('POST', '/api/financiero/pagos', { token: tokens.alumno, body: { alumno_id: 1, monto_pagado: 100 } });
            assert.equal(r.status, 403);
        });

        it('HU2: el administrador no puede quitarse su propio rol', async () => {
            const r = await api('PUT', `/api/auth/users/${users.admin.id}/rol`, { token: tokens.admin, body: { rol: 'docente' } });
            assert.equal(r.status, 400);
        });

        it('HU2: no se acepta un rol inexistente', async () => {
            const r = await api('PUT', `/api/auth/users/${users.alumno.id}/rol`, { token: tokens.admin, body: { rol: 'rey' } });
            assert.equal(r.status, 400);
        });
    });

    describe('Reglas de negocio académicas (RF10, RF11, RF14)', () => {
        it('RF11: rechaza un DNI con puntos o letras', async () => {
            const r = await api('POST', '/api/academico/alumnos', { token: tokens.admin, body: alumnoBase({ dni: '12.345.678' }) });
            assert.equal(r.status, 400);
            assert.match(r.data.message, /numérico/);
        });

        it('RF10: no asigna alumnos a un curso sin cupo', async () => {
            const niveles = await api('GET', '/api/academico/niveles');
            const curso = await api('POST', '/api/academico/cursos', {
                token: tokens.admin, body: { nivel_id: niveles.data[0].id, division: 'T' + (Date.now() % 100000), cupo: 1 }
            });
            assert.equal(curso.status, 201);
            const primero = await api('POST', '/api/academico/alumnos', { token: tokens.admin, body: alumnoBase({ curso_id: curso.data.id }) });
            assert.equal(primero.status, 201);
            const segundo = await api('POST', '/api/academico/alumnos', { token: tokens.admin, body: alumnoBase({ curso_id: curso.data.id }) });
            assert.equal(segundo.status, 400);
            assert.match(segundo.data.message, /vacantes/);
        });

        it('RF14: rechaza notas fuera del rango 1 a 10 o no enteras', async () => {
            for (const nota of [0, 11, '7.5', 'abc', '']) {
                const r = await api('POST', '/api/academico/calificaciones', {
                    token: tokens.docente, body: { alumno_id: 1, materia_id: 1, nota, trimestre: 1 }
                });
                assert.equal(r.status, 400, `la nota ${JSON.stringify(nota)} debería rechazarse`);
            }
        });

        it('RF14: guarda una nota válida', async () => {
            const alumnos = await api('GET', '/api/academico/alumnos', { token: tokens.docente });
            const materias = await api('GET', '/api/academico/materias', { token: tokens.docente });
            const r = await api('POST', '/api/academico/calificaciones', {
                token: tokens.docente, body: { alumno_id: alumnos.data[0].id, materia_id: materias.data[0].id, nota: 8, trimestre: 1 }
            });
            assert.ok([200, 201].includes(r.status), `estado inesperado ${r.status}`);
        });
    });

    describe('Asistencia (HU1, RF14)', () => {
        it('avisa si la fecha ya fue cargada y permite modificarla', async () => {
            const alumnos = await api('GET', '/api/academico/alumnos', { token: tokens.docente });
            const fecha = diasDesde(2020, 2000);
            const registros = [{ alumno_id: alumnos.data[0].id, estado: 'Presente' }];

            const alta = await api('POST', '/api/academico/asistencias', { token: tokens.docente, body: { fecha, registros } });
            assert.equal(alta.status, 201);

            const repetida = await api('POST', '/api/academico/asistencias', { token: tokens.docente, body: { fecha, registros } });
            assert.equal(repetida.status, 409);

            const modificada = await api('POST', '/api/academico/asistencias', {
                token: tokens.docente, body: { fecha, sobrescribir: true, registros: [{ ...registros[0], estado: 'Tarde' }] }
            });
            assert.equal(modificada.status, 201);
            assert.equal(modificada.data.modificados, 1);
        });

        it('rechaza estados inválidos y fechas futuras', async () => {
            const estado = await api('POST', '/api/academico/asistencias', {
                token: tokens.docente, body: { fecha: '2020-01-02', registros: [{ alumno_id: 1, estado: 'Marciano' }] }
            });
            assert.equal(estado.status, 400);
            const futura = await api('POST', '/api/academico/asistencias', {
                token: tokens.docente, body: { fecha: '2099-01-01', registros: [{ alumno_id: 1, estado: 'Presente' }] }
            });
            assert.equal(futura.status, 400);
        });
    });

    describe('Finanzas (RF17, HU6)', () => {
        it('RF17: rechaza montos de cuota iguales o menores a cero', async () => {
            for (const monto of [0, -5, 'abc']) {
                const r = await api('POST', '/api/financiero/cuotas-config', {
                    token: tokens.admin, body: { nivel_id: 1, monto, mes: 3, anio: 2027, vencimiento: '2027-03-10' }
                });
                assert.equal(r.status, 400, `el monto ${JSON.stringify(monto)} debería rechazarse`);
            }
        });

        it('HU6: el comprobante de un pago inexistente devuelve 404', async () => {
            const r = await api('GET', '/api/financiero/comprobante/2147483000', { token: tokens.admin });
            assert.equal(r.status, 404);
        });

        it('HU6: rechaza un pago de importe cero', async () => {
            const r = await api('POST', '/api/financiero/pagos', { token: tokens.admin, body: { alumno_id: 1, monto_pagado: 0 } });
            assert.equal(r.status, 400);
        });

        it('HU6: registra un pago válido y genera el comprobante en PDF', async () => {
            const alumnos = await api('GET', '/api/academico/alumnos', { token: tokens.admin });
            const pago = await api('POST', '/api/financiero/pagos', {
                token: tokens.admin, body: { alumno_id: alumnos.data[0].id, monto_pagado: 1500.5, metodo_pago: 'Transferencia' }
            });
            assert.equal(pago.status, 201);
            const pdf = await http('GET', `/api/financiero/comprobante/${pago.data.pago_id}`, { token: tokens.admin });
            assert.equal(pdf.status, 200);
            assert.match(pdf.headers.get('content-type'), /application\/pdf/);
            assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
        });
    });

    describe('Servicios (RF21, RF22)', () => {
        it('RF21: no permite reservar una instalación en un horario ocupado', async () => {
            const inst = await api('GET', '/api/servicios/instalaciones', { token: tokens.admin });
            const fecha = diasDesde(2040, 3000);
            const reserva = (inicio, fin) => api('POST', '/api/servicios/instalaciones/reservar', {
                token: tokens.admin,
                body: { instalacion_id: inst.data[0].id, fecha, hora_inicio: inicio, hora_fin: fin, reservado_por: users.admin.id, motivo: 'Prueba' }
            });
            assert.equal((await reserva('10:00', '11:00')).status, 201);
            assert.equal((await reserva('10:30', '11:30')).status, 400);
            assert.equal((await reserva('11:00', '12:00')).status, 201);
        });

        it('RF22: exige al menos 10 caracteres en la incidencia de enfermería', async () => {
            const r = await api('POST', '/api/servicios/enfermeria/incidencia', {
                token: tokens.docente, body: { alumno_id: 1, descripcion: 'corta' }
            });
            assert.equal(r.status, 400);
        });
    });

    describe('Comunicados segmentados (HU4)', () => {
        it('rechaza un comunicado con campos vacíos o sin destinatario', async () => {
            const sinTitulo = await api('POST', '/api/comunicacion/notificaciones', {
                token: tokens.admin, body: { titulo: '  ', mensaje: 'Mensaje', rol_destino: 'padre' }
            });
            assert.equal(sinTitulo.status, 400);
            const sinDestino = await api('POST', '/api/comunicacion/notificaciones', {
                token: tokens.admin, body: { titulo: 'Aviso', mensaje: 'Mensaje', rol_destino: '' }
            });
            assert.equal(sinDestino.status, 400);
            const destinoInvalido = await api('POST', '/api/comunicacion/notificaciones', {
                token: tokens.admin, body: { titulo: 'Aviso', mensaje: 'Mensaje', rol_destino: 'director' }
            });
            assert.equal(destinoInvalido.status, 400);
        });

        it('Observer: al publicar se avisa a los observadores suscriptos', async () => {
            const { comunicados } = require('../src/patterns/comunicadosObserver');
            const eventos = [];
            const baja = comunicados.suscribir(e => eventos.push(e));
            try {
                const titulo = 'Aviso observado ' + Date.now();
                const r = await api('POST', '/api/comunicacion/notificaciones', {
                    token: tokens.admin, body: { titulo, mensaje: 'Texto', rol_destino: 'docente' }
                });
                assert.equal(r.status, 201);
                assert.equal(eventos.length, 1);
                assert.equal(eventos[0].titulo, titulo);
                assert.equal(eventos[0].rol_destino, 'docente');
            } finally {
                baja();
            }
        });

        it('el comunicado lo ve solo el público elegido', async () => {
            const titulo = 'Reunión de padres ' + Date.now();
            const creado = await api('POST', '/api/comunicacion/notificaciones', {
                token: tokens.admin, body: { titulo, mensaje: 'Viernes 18 hs', rol_destino: 'padre' }
            });
            assert.equal(creado.status, 201);
            const deTitulo = lista => lista.some(n => n.titulo === titulo);
            const paraPadre = await api('GET', '/api/comunicacion/notificaciones', { token: tokens.padre });
            const paraAlumno = await api('GET', '/api/comunicacion/notificaciones', { token: tokens.alumno });
            assert.ok(deTitulo(paraPadre.data), 'el padre debería ver el comunicado');
            assert.ok(!deTitulo(paraAlumno.data), 'el alumno no debería verlo');
        });
    });

    describe('Mi Perfil (HU5)', () => {
        it('devuelve solo los datos del usuario autenticado y sin la contraseña', async () => {
            const r = await api('GET', '/api/auth/me', { token: tokens.padre });
            assert.equal(r.status, 200);
            assert.equal(r.data.username, 'padre');
            assert.equal(r.data.rol, 'padre');
            assert.equal(r.data.password, undefined);
        });

        it('exige estar autenticado', async () => {
            const r = await api('GET', '/api/auth/me');
            assert.ok([401, 403].includes(r.status));
        });
    });

    describe('Horarios sin superposición (RF13)', () => {
        it('rechaza una franja que pisa a otra del mismo docente o aula', async () => {
            const [materias, docentes, listaAulas] = await Promise.all([
                api('GET', '/api/academico/materias', { token: tokens.admin }),
                api('GET', '/api/academico/docentes', { token: tokens.admin }),
                api('GET', '/api/academico/aulas')
            ]);
            assert.ok(materias.data.length && docentes.data.length && listaAulas.data.length, 'faltan datos base (materias, docentes o aulas)');
            const horario = (inicio, fin, aula = listaAulas.data[0].id) => api('POST', '/api/academico/horarios', {
                token: tokens.admin,
                body: {
                    materia_id: materias.data[0].id, docente_id: docentes.data[0].id, aula_id: aula,
                    dia_semana: 6, hora_inicio: inicio, hora_fin: fin
                }
            });
            const creados = [];
            try {
                const primero = await horario('03:00', '04:00');
                assert.equal(primero.status, 201);
                creados.push(primero.data.id);

                const pisado = await horario('03:30', '04:30');
                assert.equal(pisado.status, 400);
                assert.match(pisado.data.message, /Superposición/);

                const contiguo = await horario('04:00', '05:00');
                assert.equal(contiguo.status, 201);
                creados.push(contiguo.data.id);

                const invertido = await horario('06:00', '05:00');
                assert.equal(invertido.status, 400);
            } finally {
                for (const id of creados) await api('DELETE', `/api/academico/horarios/${id}`, { token: tokens.admin });
            }
        });
    });

    describe('Sesión móvil: refresco de token y cambio de contraseña (HU3)', () => {
        const jwt = require('jsonwebtoken');
        const decodificar = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        const firmar = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30m' });
        const ahora = () => Math.floor(Date.now() / 1000);
        const PASS = 'Inicial1!x';
        let temporal;

        const entrar = (password) => api('POST', '/api/auth/login', { body: { username: temporal.username, password } });

        before(async () => {
            const username = `hu3-${Date.now()}`;
            const r = await api('POST', '/api/auth/users', {
                token: tokens.admin, body: { nombre: 'Familia Prueba', username, password: PASS, rol: 'padre' }
            });
            assert.equal(r.status, 201);
            temporal = { id: r.data.id, username };
        });

        after(async () => {
            if (temporal) await api('DELETE', `/api/auth/users/${temporal.id}`, { token: tokens.admin });
        });

        it('el refresco devuelve un token nuevo de 30 min, con el mismo usuario y el inicio de sesión original', async () => {
            const viejo = (await entrar(PASS)).data.token;
            const r = await api('POST', '/api/auth/refresh', { token: viejo });
            assert.equal(r.status, 200);
            assert.equal(r.data.user.id, temporal.id);
            assert.equal(r.data.user.rol, 'padre');
            const nuevo = decodificar(r.data.token);
            assert.equal(nuevo.exp - nuevo.iat, 1800);
            assert.equal(nuevo.auth_time, decodificar(viejo).auth_time);
            const me = await api('GET', '/api/auth/me', { token: r.data.token });
            assert.equal(me.status, 200);
            assert.equal(me.data.username, temporal.username);
        });

        it('el refresco exige un token válido', async () => {
            assert.equal((await api('POST', '/api/auth/refresh')).status, 403);
            assert.equal((await api('POST', '/api/auth/refresh', { token: 'no.es.un.token' })).status, 401);
            const vencido = jwt.sign({ id: temporal.id, rol: 'padre' }, process.env.JWT_SECRET, { expiresIn: -10 });
            assert.equal((await api('POST', '/api/auth/refresh', { token: vencido })).status, 401);
        });

        it('una sesión de más de 12 horas no se puede seguir renovando', async () => {
            const token = firmar({ id: temporal.id, username: temporal.username, rol: 'padre', auth_time: ahora() - 13 * 3600 });
            const r = await api('POST', '/api/auth/refresh', { token });
            assert.equal(r.status, 401);
            assert.match(r.data.message, /duración máxima/);
        });

        it('no renueva el token de una cuenta que ya no existe', async () => {
            const token = firmar({ id: 2147483000, username: 'fantasma', rol: 'padre', auth_time: ahora() });
            const r = await api('POST', '/api/auth/refresh', { token });
            assert.equal(r.status, 401);
            assert.match(r.data.message, /ya no existe/);
        });

        it('el rol del token nuevo sale de la base, no del token anterior', async () => {
            const token = firmar({ id: temporal.id, username: temporal.username, rol: 'admin', auth_time: ahora() });
            const r = await api('POST', '/api/auth/refresh', { token });
            assert.equal(r.status, 200);
            assert.equal(r.data.user.rol, 'padre');
            assert.equal(decodificar(r.data.token).rol, 'padre');
        });

        it('acepta tokens emitidos antes de esta versión (sin auth_time)', async () => {
            const token = firmar({ id: temporal.id, username: temporal.username, rol: 'padre' });
            assert.equal((await api('POST', '/api/auth/refresh', { token })).status, 200);
        });

        it('cambio de contraseña: valida los datos antes de tocar la base', async () => {
            const token = (await entrar(PASS)).data.token;
            const cambiar = (body, t = token) => api('POST', '/api/auth/change-password', { token: t, body });

            assert.equal((await cambiar({ password_actual: PASS, password_nueva: 'Otra2$clave' }, null)).status, 403);
            assert.equal((await cambiar({ password_actual: PASS })).status, 400);
            assert.equal((await cambiar({ password_nueva: 'Otra2$clave' })).status, 400);
            assert.equal((await cambiar({ password_actual: 'Incorrecta1!', password_nueva: 'Otra2$clave' })).status, 400);
            const debil = await cambiar({ password_actual: PASS, password_nueva: 'abc' });
            assert.equal(debil.status, 400);
            assert.match(debil.data.message, /8 caracteres/);
            const igual = await cambiar({ password_actual: PASS, password_nueva: PASS });
            assert.equal(igual.status, 400);
            assert.match(igual.data.message, /distinta/);
            assert.equal((await entrar(PASS)).status, 200, 'la contraseña no debió cambiar');
        });

        it('cambio de contraseña: con datos válidos reemplaza la anterior', async () => {
            const token = (await entrar(PASS)).data.token;
            const nueva = 'Nueva3#clave';
            const r = await api('POST', '/api/auth/change-password', { token, body: { password_actual: PASS, password_nueva: nueva } });
            assert.equal(r.status, 200);
            assert.equal((await entrar(PASS)).status, 401, 'la contraseña anterior sigue funcionando');
            assert.equal((await entrar(nueva)).status, 200);
        });
    });

    describe('Inscripciones a servicios (HU4)', () => {
        const MES = 6;
        const ANIO = 2040;
        const sufijo = Date.now();
        const PASS = 'Inicial1!x';
        let A; let B;            // dos padres: { id, token }
        let hijoA1; let hijoA2; let hijoB1;
        const S = {};            // servicios creados para las pruebas

        const inscribir = (token, alumno_id, servicio_id, mes = MES, anio = ANIO) =>
            api('POST', '/api/inscripciones', { token, body: { alumno_id, servicio_id, mes, anio } });
        const baja = (token, id) => api('DELETE', `/api/inscripciones/${id}`, { token });
        const crearServicio = async (clave, tipo, extra = {}) => {
            const r = await api('POST', '/api/inscripciones/servicios', {
                token: tokens.admin, body: { tipo, nombre: `HU4-${clave}-${sufijo}`, precio_mensual: 1000, ...extra }
            });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            S[clave] = r.data.id;
        };
        const crearPadre = async (etiqueta) => {
            const username = `hu4${etiqueta}-${sufijo}`;
            const r = await api('POST', '/api/auth/users', {
                token: tokens.admin, body: { nombre: `Padre ${etiqueta}`, username, password: PASS, rol: 'padre' }
            });
            assert.equal(r.status, 201);
            const l = await api('POST', '/api/auth/login', { body: { username, password: PASS } });
            return { id: r.data.id, token: l.data.token };
        };
        const crearHijo = async (padre, nombre) => (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, tutor_id)
             VALUES ($1, 'Servicios', $2, '2015-05-05', $3) RETURNING id`, [nombre, dniUnico(), padre.id]
        )).rows[0].id;

        before(async () => {
            A = await crearPadre('A');
            B = await crearPadre('B');
            hijoA1 = await crearHijo(A, 'HijoA1');
            hijoA2 = await crearHijo(A, 'HijoA2');
            hijoB1 = await crearHijo(B, 'HijoB1');
            for (const k of ['D1', 'D2', 'D3', 'D4', 'D5']) await crearServicio(k, 'Deporte');
            await crearServicio('DCUPO', 'Deporte', { cupo_max: 1 });
            await crearServicio('DCARRERA', 'Deporte', { cupo_max: 1 });
            await crearServicio('T1', 'Transporte');
            await crearServicio('T2', 'Transporte');
            await crearServicio('COMEDOR', 'Comedor');
            await crearServicio('INACTIVO', 'Deporte');
            await api('PATCH', `/api/inscripciones/servicios/${S.INACTIVO}`, { token: tokens.admin, body: { activo: false } });
        });

        after(async () => {
            const alumnos = [hijoA1, hijoA2, hijoB1];
            await db.query('DELETE FROM facturas WHERE tutor_id = ANY($1)', [[A.id, B.id]]);
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`HU4-%-${sufijo}`]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnos]);
            for (const p of [A, B]) await api('DELETE', `/api/auth/users/${p.id}`, { token: tokens.admin });
        });

        it('solo los padres y el administrador acceden', async () => {
            assert.equal((await api('GET', '/api/inscripciones/catalogo')).status, 403);
            assert.equal((await api('GET', '/api/inscripciones/catalogo', { token: tokens.alumno })).status, 403);
            assert.equal((await api('GET', '/api/inscripciones/catalogo', { token: tokens.docente })).status, 403);
            assert.equal((await api('GET', '/api/inscripciones/catalogo', { token: A.token })).status, 200);
        });

        it('el catálogo muestra los servicios activos con su cupo disponible', async () => {
            const r = await api('GET', `/api/inscripciones/catalogo?mes=${MES}&anio=${ANIO}`, { token: A.token });
            assert.equal(r.status, 200);
            const por = (clave) => r.data.servicios.find(s => s.id === S[clave]);
            assert.equal(por('D1').cupo_disponible, null, 'sin cupo máximo no hay límite');
            assert.equal(por('DCUPO').cupo_max, 1);
            assert.equal(por('DCUPO').cupo_disponible, 1);
            assert.equal(por('INACTIVO'), undefined, 'un servicio inactivo no se ofrece');
            assert.equal((await api('GET', '/api/inscripciones/catalogo?mes=13&anio=2040', { token: A.token })).status, 400);
        });

        it('inscribe a un hijo y rechaza los datos inválidos', async () => {
            const ok = await inscribir(A.token, hijoA1, S.COMEDOR);
            assert.equal(ok.status, 201);
            assert.equal(ok.data.tipo, 'Comedor');

            assert.equal((await inscribir(A.token, hijoA1, S.COMEDOR)).status, 409, 'duplicado');
            assert.equal((await inscribir(A.token, hijoB1, S.COMEDOR)).status, 403, 'hijo de otra familia');
            assert.equal((await inscribir(A.token, 2147483000, S.COMEDOR)).status, 404, 'alumno inexistente');
            assert.equal((await inscribir(A.token, hijoA1, 2147483000)).status, 404, 'servicio inexistente');
            assert.equal((await inscribir(A.token, hijoA1, S.INACTIVO)).status, 404, 'servicio inactivo');
            assert.equal((await inscribir(A.token, hijoA1, S.D1, 13)).status, 400, 'mes inválido');
            assert.equal((await inscribir(A.token, hijoA1, S.D1, 1, 2021)).status, 400, 'mes que ya pasó');
            assert.equal((await api('POST', '/api/inscripciones', { token: A.token, body: { mes: MES, anio: ANIO } })).status, 400, 'faltan datos');
        });

        it('máximo 2 deportes por alumno y por mes', async () => {
            const d1 = await inscribir(A.token, hijoA1, S.D1);
            assert.equal(d1.status, 201);
            assert.equal((await inscribir(A.token, hijoA1, S.D2)).status, 201);
            const tercero = await inscribir(A.token, hijoA1, S.D3);
            assert.equal(tercero.status, 409);
            assert.match(tercero.data.message, /máximo en 2 deportes/);

            assert.equal((await inscribir(A.token, hijoA1, S.D3, MES + 1)).status, 201, 'el límite es por mes');
            assert.equal((await baja(A.token, d1.data.id)).status, 200);
            assert.equal((await inscribir(A.token, hijoA1, S.D3)).status, 201, 'al dar de baja uno, se libera lugar');
        });

        it('un solo recorrido de transporte por mes, que puede cambiar al mes siguiente', async () => {
            const t1 = await inscribir(A.token, hijoA1, S.T1);
            assert.equal(t1.status, 201);
            const otro = await inscribir(A.token, hijoA1, S.T2);
            assert.equal(otro.status, 409);
            assert.match(otro.data.message, /transporte/);
            assert.equal((await inscribir(A.token, hijoA1, S.T2, MES + 1)).status, 201, 'otro recorrido el mes siguiente');
            await baja(A.token, t1.data.id);
            assert.equal((await inscribir(A.token, hijoA1, S.T2)).status, 201, 'tras la baja, elige el otro recorrido');
        });

        it('los distintos tipos de servicio no se pisan entre sí', async () => {
            assert.equal((await inscribir(A.token, hijoA2, S.COMEDOR)).status, 201);
            assert.equal((await inscribir(A.token, hijoA2, S.D1)).status, 201);
            assert.equal((await inscribir(A.token, hijoA2, S.T1)).status, 201);
        });

        it('no inscribe cuando el servicio ya no tiene cupo, y la baja lo libera', async () => {
            const primero = await inscribir(A.token, hijoA2, S.DCUPO);
            assert.equal(primero.status, 201);
            const sin = await inscribir(B.token, hijoB1, S.DCUPO);
            assert.equal(sin.status, 409);
            assert.match(sin.data.message, /cupo/);

            const cat = await api('GET', `/api/inscripciones/catalogo?mes=${MES}&anio=${ANIO}`, { token: B.token });
            assert.equal(cat.data.servicios.find(s => s.id === S.DCUPO).cupo_disponible, 0);

            await baja(A.token, primero.data.id);
            assert.equal((await inscribir(B.token, hijoB1, S.DCUPO)).status, 201);
        });

        it('dos pedidos simultáneos por el último cupo: solo uno se inscribe', async () => {
            const [x, y] = await Promise.all([
                inscribir(A.token, hijoA1, S.DCARRERA, MES + 2),
                inscribir(B.token, hijoB1, S.DCARRERA, MES + 2),
            ]);
            assert.deepEqual([x.status, y.status].sort(), [201, 409]);
        });

        it('tres pedidos simultáneos de deportes para el mismo alumno: solo entran 2', async () => {
            const pedidos = await Promise.all(['D3', 'D4', 'D5'].map(k => inscribir(A.token, hijoA2, S[k], MES + 3)));
            assert.deepEqual(pedidos.map(p => p.status).sort(), [201, 201, 409]);
            const lista = await api('GET', `/api/inscripciones/alumno/${hijoA2}?mes=${MES + 3}&anio=${ANIO}`, { token: A.token });
            assert.equal(lista.data.length, 2);
        });

        it('lista las inscripciones activas del hijo, solo para su familia o el administrador', async () => {
            const propia = await api('GET', `/api/inscripciones/alumno/${hijoA2}`, { token: A.token });
            assert.equal(propia.status, 200);
            assert.ok(propia.data.length >= 3);
            assert.ok(propia.data.every(i => i.estado === 'Activa'));
            assert.equal((await api('GET', `/api/inscripciones/alumno/${hijoA2}`, { token: B.token })).status, 403);
            assert.equal((await api('GET', `/api/inscripciones/alumno/${hijoA2}`, { token: tokens.admin })).status, 200);
            assert.equal((await api('GET', '/api/inscripciones/alumno/2147483000', { token: A.token })).status, 404);
            const mes = await api('GET', `/api/inscripciones/alumno/${hijoA2}?mes=${MES}&anio=${ANIO}`, { token: A.token });
            assert.ok(mes.data.every(i => i.mes === MES && i.anio === ANIO));
        });

        it('la baja es solo de la familia, se puede revertir y no procede si ya se facturó', async () => {
            const insc = await inscribir(A.token, hijoA1, S.D4, MES + 4);
            assert.equal(insc.status, 201);
            assert.equal((await baja(B.token, insc.data.id)).status, 403, 'otra familia');
            assert.equal((await baja(A.token, 2147483000)).status, 404);
            assert.equal((await baja(A.token, insc.data.id)).status, 200);
            const repetida = await baja(A.token, insc.data.id);
            assert.equal(repetida.status, 200);
            assert.match(repetida.data.message, /ya estaba/);

            const reactivada = await inscribir(A.token, hijoA1, S.D4, MES + 4);
            assert.equal(reactivada.status, 201);
            assert.equal(reactivada.data.id, insc.data.id, 'se reactiva la misma inscripción');

            const factura = (await db.query(
                "INSERT INTO facturas (tutor_id, referencia, total) VALUES ($1, $2, 1000) RETURNING id", [A.id, `HU4-${sufijo}`]
            )).rows[0].id;
            await db.query(
                "INSERT INTO factura_items (factura_id, alumno_id, inscripcion_id, descripcion, monto) VALUES ($1, $2, $3, 'Deporte', 1000)",
                [factura, hijoA1, insc.data.id]
            );
            const facturada = await baja(A.token, insc.data.id);
            assert.equal(facturada.status, 409);
            assert.match(facturada.data.message, /facturada/);

            await db.query("UPDATE facturas SET estado = 'Rechazada' WHERE id = $1", [factura]);
            assert.equal((await baja(A.token, insc.data.id)).status, 200, 'con la factura rechazada vuelve a ser posible');
        });

        it('el administrador puede inscribir a cualquier alumno', async () => {
            const r = await inscribir(tokens.admin, hijoB1, S.COMEDOR);
            assert.equal(r.status, 201);
        });

        it('el catálogo lo administra solo el administrador y valida los datos', async () => {
            const nuevo = (body, token = tokens.admin) => api('POST', '/api/inscripciones/servicios', { token, body });
            assert.equal((await nuevo({ tipo: 'Deporte', nombre: 'X', precio_mensual: 100 }, A.token)).status, 403);
            assert.equal((await nuevo({ tipo: 'Piscina', nombre: 'X', precio_mensual: 100 })).status, 400);
            assert.equal((await nuevo({ tipo: 'Deporte', nombre: '  ', precio_mensual: 100 })).status, 400);
            assert.equal((await nuevo({ tipo: 'Deporte', nombre: 'X', precio_mensual: 0 })).status, 400);
            assert.equal((await nuevo({ tipo: 'Deporte', nombre: 'X', precio_mensual: 100, cupo_max: 0 })).status, 400);
            assert.equal((await nuevo({ tipo: 'Transporte', nombre: `HU4-Ruta-${sufijo}`, precio_mensual: 100, ruta_id: 2147483000 })).status, 400);
            const dup = await nuevo({ tipo: 'Deporte', nombre: `HU4-D1-${sufijo}`, precio_mensual: 100 });
            assert.equal(dup.status, 409);

            const patch = (body, id = S.D5, token = tokens.admin) => api('PATCH', `/api/inscripciones/servicios/${id}`, { token, body });
            assert.equal((await patch({})).status, 400);
            assert.equal((await patch({ precio_mensual: -5 })).status, 400);
            assert.equal((await patch({ activo: 'si' })).status, 400);
            assert.equal((await patch({ precio_mensual: 1500 }, 2147483000)).status, 404);
            assert.equal((await patch({ precio_mensual: 1500 }, S.D5, A.token)).status, 403);
            assert.equal((await patch({ precio_mensual: 1500, cupo_max: 25 })).status, 200);
            const cat = await api('GET', `/api/inscripciones/catalogo?mes=${MES}&anio=${ANIO}`, { token: A.token });
            const d5 = cat.data.servicios.find(s => s.id === S.D5);
            assert.equal(d5.precio_mensual, 1500);
            assert.equal(d5.cupo_max, 25);
        });
    });
});
