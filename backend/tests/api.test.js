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

    // --- Datos de apoyo para crear grupos de deporte y servicios de transporte en las pruebas ---
    // Cada grupo lleva su propio deporte, un día y un horario distintos, para no chocar entre sí.
    const apoyo = { docente: null, docente2: null, nivel: null, nivel2: null, rutas: [], rutasTemporales: [], actividades: [], docentes: [] };
    let contadorGrupos = 0;

    const nuevoDocente = async (apellido, extra = {}) => {
        const campos = { tipo: 'Docente', estado: 'Activo', ...extra };
        const id = (await db.query(
            'INSERT INTO personal (nombre, apellido, dni, tipo, estado) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            ['Prof', `${apellido} ${Date.now()}`, dniUnico(), campos.tipo, campos.estado]
        )).rows[0].id;
        apoyo.docentes.push(id);
        return id;
    };
    const nuevaActividad = async (tipo = 'Deporte') => {
        const id = (await db.query(
            "INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, $2, 'x', 30) RETURNING id",
            [`PruebaDep-${Date.now()}-${++seq}`, tipo]
        )).rows[0].id;
        apoyo.actividades.push(id);
        return id;
    };
    // Datos completos de un grupo de deporte nuevo (cada uno en su propio día u hora)
    const datosGrupo = async (extra = {}) => {
        const i = contadorGrupos++;
        const turnos = [['16:00', '17:00'], ['18:00', '19:00'], ['20:00', '21:00']];
        const [inicio, fin] = turnos[Math.floor(i / 7) % turnos.length];
        return {
            actividad_id: await nuevaActividad(),
            docente_id: apoyo.docente,
            nivel_id: apoyo.nivel,
            dia_semana: (i % 7) + 1,
            hora_inicio: inicio,
            hora_fin: fin,
            ...extra,
        };
    };
    // Recorridos disponibles: los de la base y, si faltan, algunos temporales (sin pasar de cuatro)
    const prepararApoyo = async () => {
        apoyo.docente = await nuevoDocente('Uno');
        apoyo.docente2 = await nuevoDocente('Dos');
        const niveles = (await db.query('SELECT id FROM niveles ORDER BY id LIMIT 2')).rows.map(n => n.id);
        [apoyo.nivel, apoyo.nivel2] = niveles;
        apoyo.rutas = (await db.query('SELECT id FROM transporte_rutas ORDER BY id LIMIT 4')).rows.map(r => r.id);
        while (apoyo.rutas.length < 3) {
            const id = (await db.query(
                "INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Prueba', 10) RETURNING id", [`RutaPrueba-${Date.now()}-${++seq}`]
            )).rows[0].id;
            apoyo.rutasTemporales.push(id);
            apoyo.rutas.push(id);
        }
    };
    const limpiarApoyo = async () => {
        if (apoyo.actividades.length) await db.query('DELETE FROM actividades_extra WHERE id = ANY($1)', [apoyo.actividades]);
        if (apoyo.docentes.length) await db.query('DELETE FROM personal WHERE id = ANY($1)', [apoyo.docentes]);
        if (apoyo.rutasTemporales.length) await db.query('DELETE FROM transporte_rutas WHERE id = ANY($1)', [apoyo.rutasTemporales]);
    };

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
        await prepararApoyo();
    });

    after(async () => {
        await limpiarApoyo();
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
            const propios = tipo === 'Deporte' ? await datosGrupo()
                : tipo === 'Transporte' ? { ruta_id: apoyo.rutas[clave === 'T2' ? 1 : 0] } : {};
            const r = await api('POST', '/api/inscripciones/servicios', {
                token: tokens.admin, body: { tipo, nombre: `HU4-${clave}-${sufijo}`, precio_mensual: 1000, ...propios, ...extra }
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

        it('acceden los padres, el administrador y los alumnos (solo a sus deportes); el docente no', async () => {
            assert.equal((await api('GET', '/api/inscripciones/catalogo')).status, 403);
            const delAlumno = await api('GET', '/api/inscripciones/catalogo', { token: tokens.alumno });
            assert.equal(delAlumno.status, 200);
            assert.ok(delAlumno.data.servicios.every(s => s.tipo === 'Deporte'), 'el alumno solo ve deportes');
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
            const dup = await nuevo({ tipo: 'Deporte', nombre: `HU4-D1-${sufijo}`, precio_mensual: 100, ...(await datosGrupo({ docente_id: apoyo.docente2 })) });
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

    describe('Resumen de la familia para la app móvil (HU5)', () => {
        const MES = 6;
        const ANIO = 2041;
        const sufijo = Date.now();
        const PASS = 'Inicial1!x';
        let C; let D; let E;     // C: dos hijos; D: sin hijos; E: otra familia con un hijo
        let hijoC1; let hijoC2; let hijoE1;
        const S = {};

        const resumen = (token, query = `?mes=${MES}&anio=${ANIO}`) => api('GET', `/api/inscripciones/resumen-familia${query}`, { token });
        const crearPadre = async (etiqueta) => {
            const username = `hu5${etiqueta}-${sufijo}`;
            const r = await api('POST', '/api/auth/users', {
                token: tokens.admin, body: { nombre: `Padre ${etiqueta}`, username, password: PASS, rol: 'padre' }
            });
            assert.equal(r.status, 201);
            const l = await api('POST', '/api/auth/login', { body: { username, password: PASS } });
            return { id: r.data.id, token: l.data.token };
        };
        const crearHijo = async (padre, nombre, apellido) => (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, tutor_id)
             VALUES ($1, $2, $3, '2015-05-05', $4) RETURNING id`, [nombre, apellido, dniUnico(), padre.id]
        )).rows[0].id;
        const crearServicio = async (clave, tipo, precio) => {
            const propios = tipo === 'Deporte' ? await datosGrupo() : tipo === 'Transporte' ? { ruta_id: apoyo.rutas[0] } : {};
            const r = await api('POST', '/api/inscripciones/servicios', {
                token: tokens.admin, body: { tipo, nombre: `HU5-${clave}-${sufijo}`, precio_mensual: precio, ...propios }
            });
            assert.equal(r.status, 201);
            S[clave] = r.data.id;
        };
        const inscribir = (token, alumno_id, servicio_id, mes = MES) =>
            api('POST', '/api/inscripciones', { token, body: { alumno_id, servicio_id, mes, anio: ANIO } });
        const comedor = (alumno, fecha, consumio) => db.query(
            'INSERT INTO comedor_asistencias (alumno_id, fecha, consumio_menu) VALUES ($1, $2, $3)', [alumno, fecha, consumio]);

        before(async () => {
            C = await crearPadre('C');
            D = await crearPadre('D');
            E = await crearPadre('E');
            hijoC1 = await crearHijo(C, 'Ana', 'Zuñiga');
            hijoC2 = await crearHijo(C, 'Beto', 'Alvarez');
            hijoE1 = await crearHijo(E, 'Eva', 'Ajena');
            await crearServicio('FUTBOL', 'Deporte', 6000);
            await crearServicio('TRANS', 'Transporte', 12000);
            await crearServicio('COMEDOR', 'Comedor', 25000);

            // Ana: fútbol + comedor este mes, y transporte el mes siguiente (no debe aparecer en junio)
            await inscribir(C.token, hijoC1, S.FUTBOL);
            await inscribir(C.token, hijoC1, S.COMEDOR);
            await inscribir(C.token, hijoC1, S.TRANS, MES + 1);
            // Beto: sin servicios. La familia E tiene su propio hijo inscripto.
            await inscribir(E.token, hijoE1, S.FUTBOL);

            // Comedor de Ana: 3 días registrados en junio (2 con menú) y 1 día de mayo (no cuenta)
            await comedor(hijoC1, `${ANIO}-06-03`, true);
            await comedor(hijoC1, `${ANIO}-06-04`, true);
            await comedor(hijoC1, `${ANIO}-06-05`, false);
            await comedor(hijoC1, `${ANIO}-05-31`, true);
            await comedor(hijoC1, `${ANIO}-07-01`, true);

            // Saldo: Ana debe, Beto no tiene registro
            await db.query('INSERT INTO saldos_alumnos (alumno_id, saldo_pendiente) VALUES ($1, 15000.5)', [hijoC1]);
        });

        after(async () => {
            const alumnos = [hijoC1, hijoC2, hijoE1];
            await db.query('DELETE FROM comedor_asistencias WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM saldos_alumnos WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`HU5-%-${sufijo}`]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnos]);
            for (const p of [C, D, E]) await api('DELETE', `/api/auth/users/${p.id}`, { token: tokens.admin });
        });

        it('es solo para padres y valida el período', async () => {
            assert.equal((await api('GET', '/api/inscripciones/resumen-familia')).status, 403);
            assert.equal((await resumen(tokens.admin)).status, 403);
            assert.equal((await resumen(tokens.docente)).status, 403);
            assert.equal((await resumen(tokens.alumno)).status, 403);
            assert.equal((await resumen(C.token, '?mes=13&anio=2041')).status, 400);
            assert.equal((await resumen(C.token, '?mes=6&anio=1900')).status, 400);
            assert.equal((await resumen(C.token, '')).status, 200, 'sin período usa el mes actual');
        });

        it('muestra solo los hijos del padre autenticado', async () => {
            const r = await resumen(C.token);
            assert.equal(r.status, 200);
            assert.deepEqual(r.data.hijos.map(h => h.id).sort(), [hijoC1, hijoC2].sort());
            assert.ok(!r.data.hijos.some(h => h.id === hijoE1), 'no debe aparecer el hijo de otra familia');
            assert.equal(r.data.resumen.cantidad_hijos, 2);
            assert.deepEqual(r.data.hijos.map(h => h.apellido), ['Alvarez', 'Zuñiga'], 'ordenados por apellido');

            const otra = await resumen(E.token);
            assert.deepEqual(otra.data.hijos.map(h => h.id), [hijoE1]);
        });

        it('un padre sin hijos recibe una lista vacía', async () => {
            const r = await resumen(D.token);
            assert.equal(r.status, 200);
            assert.deepEqual(r.data.hijos, []);
            assert.equal(r.data.resumen.saldo_total, 0);
        });

        it('trae los servicios inscriptos del mes, con su precio y el total', async () => {
            const r = await resumen(C.token);
            const ana = r.data.hijos.find(h => h.id === hijoC1);
            const beto = r.data.hijos.find(h => h.id === hijoC2);
            assert.deepEqual(ana.servicios.map(s => s.tipo).sort(), ['Comedor', 'Deporte']);
            assert.equal(ana.total_servicios_mes, 31000);
            assert.equal(beto.servicios.length, 0);
            assert.equal(beto.total_servicios_mes, 0);
            assert.equal(r.data.resumen.total_servicios_mes, 31000);

            const julio = await resumen(C.token, `?mes=${MES + 1}&anio=${ANIO}`);
            const anaJulio = julio.data.hijos.find(h => h.id === hijoC1);
            assert.deepEqual(anaJulio.servicios.map(s => s.tipo), ['Transporte'], 'cada mes muestra sus servicios');
        });

        it('una inscripción dada de baja deja de aparecer', async () => {
            const insc = await inscribir(C.token, hijoC2, S.FUTBOL);
            assert.equal(insc.status, 201);
            let r = await resumen(C.token);
            assert.equal(r.data.hijos.find(h => h.id === hijoC2).servicios.length, 1);
            await api('DELETE', `/api/inscripciones/${insc.data.id}`, { token: C.token });
            r = await resumen(C.token);
            assert.equal(r.data.hijos.find(h => h.id === hijoC2).servicios.length, 0);
        });

        it('informa el consumo real del comedor a partir de la asistencia registrada', async () => {
            const r = await resumen(C.token);
            const ana = r.data.hijos.find(h => h.id === hijoC1);
            assert.deepEqual(ana.comedor, { inscripto: true, dias_consumidos: 2, dias_registrados: 3 });
            const beto = r.data.hijos.find(h => h.id === hijoC2);
            assert.deepEqual(beto.comedor, { inscripto: false, dias_consumidos: 0, dias_registrados: 0 });
        });

        it('informa el saldo y el estado de cuenta de cada hijo', async () => {
            const r = await resumen(C.token);
            const ana = r.data.hijos.find(h => h.id === hijoC1);
            const beto = r.data.hijos.find(h => h.id === hijoC2);
            assert.equal(ana.saldo_pendiente, 15000.5);
            assert.equal(ana.estado_cuenta, 'Pendiente');
            assert.equal(beto.saldo_pendiente, 0);
            assert.equal(beto.estado_cuenta, 'Al día');
            assert.equal(r.data.resumen.saldo_total, 15000.5);
        });

        it('los hijos sin curso asignado se informan sin nivel ni división', async () => {
            const r = await resumen(C.token);
            const ana = r.data.hijos.find(h => h.id === hijoC1);
            assert.equal(ana.nivel, null);
            assert.equal(ana.division, null);
        });
    });

    describe('Deportes por grupo, horarios y recorridos', () => {
        const sufijo = Date.now();
        const PASS = 'Inicial1!x';
        const MES = 6;
        const ANIO = 2042;
        let P;                          // un padre con alumnos de prueba
        const alumnos = [];
        const cursos = [];
        const grupos = [];

        const crear = (body, token = tokens.admin) => api('POST', '/api/inscripciones/servicios', {
            token, body: { tipo: 'Deporte', precio_mensual: 1000, ...body }
        });
        const nuevoGrupo = async (extra = {}) => {
            const datos = await datosGrupo(extra);
            const r = await crear({ nombre: `DG-${sufijo}-${grupos.length}`, ...datos });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            grupos.push(r.data.id);
            return { id: r.data.id, ...datos };
        };
        const nuevoAlumno = async (cursoId = null) => {
            const id = (await db.query(
                `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, tutor_id, curso_id)
                 VALUES ('Dep', 'Grupos', $1, '2015-05-05', $2, $3) RETURNING id`, [dniUnico(), P.id, cursoId]
            )).rows[0].id;
            alumnos.push(id);
            return id;
        };
        const inscribir = (alumno_id, servicio_id) => api('POST', '/api/inscripciones', {
            token: P.token, body: { alumno_id, servicio_id, mes: MES, anio: ANIO }
        });

        before(async () => {
            const username = `dg-${sufijo}`;
            const r = await api('POST', '/api/auth/users', {
                token: tokens.admin, body: { nombre: 'Padre Deportes', username, password: PASS, rol: 'padre' }
            });
            assert.equal(r.status, 201);
            const l = await api('POST', '/api/auth/login', { body: { username, password: PASS } });
            P = { id: r.data.id, token: l.data.token };
        });

        after(async () => {
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`DG-${sufijo}-%`]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnos]);
            if (cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [cursos]);
            await api('DELETE', `/api/auth/users/${P.id}`, { token: tokens.admin });
        });

        it('un grupo de deporte exige deporte, profesor, nivel y un horario válido', async () => {
            const base = await datosGrupo();
            const probar = async (cambios, esperado = 400) => {
                const r = await crear({ nombre: `DG-${sufijo}-x`, ...base, ...cambios });
                assert.equal(r.status, esperado, `${JSON.stringify(cambios)} -> ${JSON.stringify(r.data)}`);
            };
            await probar({ actividad_id: undefined });
            await probar({ docente_id: undefined });
            await probar({ nivel_id: undefined });
            await probar({ dia_semana: 8 });
            await probar({ dia_semana: undefined });
            await probar({ hora_inicio: '9:00' });
            await probar({ hora_inicio: '17:00', hora_fin: '16:00' });
            await probar({ hora_inicio: '16:00', hora_fin: '16:00' });
            await probar({ nivel_id: 2147483000 });
            await probar({ docente_id: 2147483000 });
            await probar({ actividad_id: await nuevaActividad('Idioma') });
            await probar({ docente_id: await nuevoDocente('Admin', { tipo: 'Administrativo' }) });
            await probar({ docente_id: await nuevoDocente('Inactivo', { estado: 'Inactivo' }) });
        });

        it('el catálogo muestra el deporte, el nivel, el profesor y el horario de cada grupo', async () => {
            const g = await nuevoGrupo({ hora_inicio: '16:30', hora_fin: '17:45' });
            const cat = await api('GET', `/api/inscripciones/catalogo?mes=${MES}&anio=${ANIO}`, { token: P.token });
            const fila = cat.data.servicios.find(s => s.id === g.id);
            assert.ok(fila.deporte.startsWith('PruebaDep'));
            assert.ok(fila.nivel);
            assert.match(fila.docente, /^Prof Uno/);
            assert.equal(fila.dia_semana, g.dia_semana);
            assert.equal(fila.hora_inicio, '16:30');
            assert.equal(fila.hora_fin, '17:45');
        });

        it('un profesor no puede tener dos grupos a la misma hora, pero sí uno a continuación del otro', async () => {
            const a = await nuevoGrupo({ dia_semana: 2, hora_inicio: '10:00', hora_fin: '11:00' });
            const choque = await crear({ nombre: `DG-${sufijo}-choque`, ...(await datosGrupo({ docente_id: a.docente_id, dia_semana: 2, hora_inicio: '10:30', hora_fin: '11:30' })) });
            assert.equal(choque.status, 409);
            assert.match(choque.data.message, /ya tiene el grupo/);
            await nuevoGrupo({ dia_semana: 2, hora_inicio: '11:00', hora_fin: '12:00' });  // contiguo: se permite
            await nuevoGrupo({ dia_semana: 3, hora_inicio: '10:30', hora_fin: '11:30' });  // otro día: se permite
        });

        it('el alumno no puede anotarse en dos deportes cuyo horario se pisa', async () => {
            const alumno = await nuevoAlumno();
            const g1 = await nuevoGrupo({ docente_id: apoyo.docente, dia_semana: 4, hora_inicio: '13:00', hora_fin: '14:00' });
            const g2 = await nuevoGrupo({ docente_id: apoyo.docente2, dia_semana: 4, hora_inicio: '13:30', hora_fin: '14:30' });
            const g3 = await nuevoGrupo({ dia_semana: 4, hora_inicio: '14:00', hora_fin: '15:00' });
            assert.equal((await inscribir(alumno, g1.id)).status, 201);
            const choque = await inscribir(alumno, g2.id);
            assert.equal(choque.status, 409);
            assert.match(choque.data.message, /se superpone/);
            assert.equal((await inscribir(alumno, g3.id)).status, 201, 'a continuación del otro se permite');
        });

        it('el alumno no puede anotarse dos veces en el mismo deporte (en otro grupo)', async () => {
            const alumno = await nuevoAlumno();
            const actividad = await nuevaActividad();
            const g1 = await nuevoGrupo({ actividad_id: actividad, dia_semana: 5, hora_inicio: '09:00', hora_fin: '10:00' });
            const g2 = await nuevoGrupo({ actividad_id: actividad, dia_semana: 6, hora_inicio: '09:00', hora_fin: '10:00' });
            assert.equal((await inscribir(alumno, g1.id)).status, 201);
            const otro = await inscribir(alumno, g2.id);
            assert.equal(otro.status, 409);
            assert.match(otro.data.message, /este deporte/);
        });

        it('el grupo es para un nivel: se controla contra el curso del alumno', async () => {
            const curso = (await db.query(
                "INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, 'ZZ', 30) RETURNING id", [apoyo.nivel]
            )).rows[0].id;
            cursos.push(curso);
            const delNivel = await nuevoAlumno(curso);
            const sinCurso = await nuevoAlumno();
            const grupoMismoNivel = await nuevoGrupo({ nivel_id: apoyo.nivel, dia_semana: 7, hora_inicio: '09:00', hora_fin: '10:00' });
            const grupoOtroNivel = await nuevoGrupo({ nivel_id: apoyo.nivel2, dia_semana: 7, hora_inicio: '10:00', hora_fin: '11:00', docente_id: apoyo.docente2 });

            assert.equal((await inscribir(delNivel, grupoMismoNivel.id)).status, 201);
            const otroNivel = await inscribir(delNivel, grupoOtroNivel.id);
            assert.equal(otroNivel.status, 409);
            assert.match(otroNivel.data.message, /nivel/);
            assert.equal((await inscribir(sinCurso, grupoOtroNivel.id)).status, 201, 'sin curso asignado no se puede comparar');
        });

        it('se puede cambiar el profesor a cargo de un grupo, sin pisar sus otros horarios', async () => {
            const g = await nuevoGrupo({ dia_semana: 1, hora_inicio: '07:00', hora_fin: '08:00' });
            const ocupado = await nuevoGrupo({ docente_id: apoyo.docente2, dia_semana: 1, hora_inicio: '07:30', hora_fin: '08:30' });
            const cambiar = (id, body) => api('PATCH', `/api/inscripciones/servicios/${id}`, { token: tokens.admin, body });

            const choque = await cambiar(g.id, { docente_id: apoyo.docente2 });
            assert.equal(choque.status, 409);
            assert.match(choque.data.message, new RegExp(`DG-${sufijo}`));
            assert.equal((await cambiar(g.id, { docente_id: 2147483000 })).status, 400);
            assert.equal((await cambiar(g.id, { docente_id: null })).status, 400);

            const libre = await nuevoDocente('Libre');
            assert.equal((await cambiar(g.id, { docente_id: libre })).status, 200);
            const fila = (await db.query('SELECT docente_id FROM servicios WHERE id = $1', [g.id])).rows[0];
            assert.equal(fila.docente_id, libre);
            assert.ok(ocupado.id);
        });

        it('solo los grupos de deporte tienen profesor', async () => {
            const comedor = await api('POST', '/api/inscripciones/servicios', {
                token: tokens.admin, body: { tipo: 'Comedor', nombre: `DG-${sufijo}-comedor`, precio_mensual: 100 }
            });
            assert.equal(comedor.status, 201);
            grupos.push(comedor.data.id);
            const r = await api('PATCH', `/api/inscripciones/servicios/${comedor.data.id}`, { token: tokens.admin, body: { docente_id: apoyo.docente } });
            assert.equal(r.status, 400);
        });

        it('un servicio de transporte necesita un recorrido que exista', async () => {
            const crearT = (extra) => api('POST', '/api/inscripciones/servicios', {
                token: tokens.admin, body: { tipo: 'Transporte', nombre: `DG-${sufijo}-t`, precio_mensual: 100, ...extra }
            });
            assert.equal((await crearT({})).status, 400);
            assert.equal((await crearT({ ruta_id: 2147483000 })).status, 400);
            const ok = await crearT({ ruta_id: apoyo.rutas[0] });
            assert.equal(ok.status, 201);
            grupos.push(ok.data.id);
        });

        it('el servicio de transporte tiene como máximo cuatro recorridos', async () => {
            const temporales = [];
            try {
                let total = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_rutas')).rows[0].n;
                while (total < 4) {
                    temporales.push((await db.query(
                        "INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Prueba', 10) RETURNING id", [`Tope-${Date.now()}-${++seq}`]
                    )).rows[0].id);
                    total++;
                }
                const quinta = await api('POST', '/api/servicios/transporte/rutas', {
                    token: tokens.admin, body: { nombre: 'Ruta de más', chofer: 'X', capacidad: 10 }
                });
                assert.equal(quinta.status, 409);
                assert.match(quinta.data.message, /máximo 4 recorridos/);
            } finally {
                if (temporales.length) await db.query('DELETE FROM transporte_rutas WHERE id = ANY($1)', [temporales]);
            }
        });
    });

    describe('Reportes de la Dirección (ARTE-2, Sprint B)', () => {
        const tag = String(Date.now());
        const MES = 6;
        const ANIO = 2043;
        const PASS = 'Inicial1!x';
        const F = {};                 // fixtures: ids
        const leg = (id) => `A-${String(id).padStart(5, '0')}`;
        const get = (path, token = tokens.admin) => api('GET', `/api/reportes${path}`, { token });
        const periodo = `mes=${MES}&anio=${ANIO}`;
        const filas = (r, seccion = 0) => r.data.secciones[seccion].filas;
        const delAlumno = (r, id, seccion = 0) => filas(r, seccion).filter(x => x.legajo === leg(id));

        const alumno = async (apellido, cursoId, estado = 'Activo') => (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, estado)
             VALUES ('Rep', $1, $2, '2015-05-05', $3, $4) RETURNING id`, [apellido, dniUnico(), cursoId, estado]
        )).rows[0].id;
        const curso = async (nivelId, division) => (await db.query(
            'INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 30) RETURNING id', [nivelId, division])).rows[0].id;
        const materia = async (nombre, cursoId) => (await db.query(
            'INSERT INTO materias (nombre, curso_id) VALUES ($1, $2) RETURNING id', [`${nombre} ${tag}`, cursoId])).rows[0].id;
        const horario = (materiaId, docenteId, dia, ini, fin) => db.query(
            'INSERT INTO horarios (materia_id, docente_id, aula_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, (SELECT id FROM aulas ORDER BY id LIMIT 1), $3, $4, $5)',
            [materiaId, docenteId, dia, ini, fin]);
        const servicio = async (body) => {
            const r = await api('POST', '/api/inscripciones/servicios', { token: tokens.admin, body: { precio_mensual: 1000, ...body } });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.id;
        };
        const inscribir = async (alumnoId, servicioId, mes = MES) => {
            const r = await api('POST', '/api/inscripciones', { token: tokens.admin, body: { alumno_id: alumnoId, servicio_id: servicioId, mes, anio: ANIO } });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.id;
        };

        before(async () => {
            F.c1 = await curso(apoyo.nivel, `R1-${tag}`);
            F.c2 = await curso(apoyo.nivel2, `R2-${tag}`);
            F.m1 = await materia('Matemática', F.c1);
            F.m2 = await materia('Lengua', F.c1);
            F.m3 = await materia('Historia', F.c2);
            F.m4 = await materia('Sin profesor', F.c1);
            await horario(F.m1, apoyo.docente, 1, '08:00', '09:30');
            await horario(F.m3, apoyo.docente, 3, '10:00', '11:00');
            await horario(F.m2, apoyo.docente2, 2, '08:00', '09:00');

            F.a1 = await alumno('Aguirre', F.c1);
            F.a2 = await alumno('Benitez', F.c1);
            F.a3 = await alumno('Cabral', F.c2);
            F.a4 = await alumno('Dominguez', F.c1, 'Inactivo');
            F.a5 = await alumno('Echeverria', null);
            F.a6 = await alumno('=Evil', F.c2);

            // Deportes: un grupo por nivel, cada uno con su profesor y su horario
            const dg1 = await datosGrupo({ nivel_id: apoyo.nivel, docente_id: apoyo.docente, dia_semana: 2, hora_inicio: '16:00', hora_fin: '17:00' });
            const dg2 = await datosGrupo({ nivel_id: apoyo.nivel2, docente_id: apoyo.docente2, dia_semana: 4, hora_inicio: '17:00', hora_fin: '18:30' });
            F.actividad1 = dg1.actividad_id;
            F.g1 = await servicio({ tipo: 'Deporte', nombre: `RP-G1-${tag}`, ...dg1 });
            F.g2 = await servicio({ tipo: 'Deporte', nombre: `RP-G2-${tag}`, ...dg2 });
            F.i1 = await inscribir(F.a1, F.g1);
            F.i2 = await inscribir(F.a2, F.g1);
            await inscribir(F.a3, F.g2);
            await inscribir(F.a5, F.g2);

            // Transporte: A1 con asignación y además inscripción del mes (se cuenta una sola vez), A2 solo inscripción
            F.ruta = apoyo.rutas[0];
            F.ruta2 = apoyo.rutas[1];
            F.t1 = await servicio({ tipo: 'Transporte', nombre: `RP-T1-${tag}`, ruta_id: F.ruta });
            await inscribir(F.a1, F.t1);
            await inscribir(F.a2, F.t1);
            const asignar = (alumno_id, ruta_id, punto_encuentro) => api('POST', '/api/servicios/transporte/asignar', {
                token: tokens.admin, body: { alumno_id, ruta_id, punto_encuentro }
            });
            assert.equal((await asignar(F.a1, F.ruta, 'Plaza Central')).status, 201);
            assert.equal((await asignar(F.a3, F.ruta2, 'Esquina Norte')).status, 201);

            // Comedor de A1: inscripto, 2 días registrados (1 con menú)
            F.comedor = await servicio({ tipo: 'Comedor', nombre: `RP-C-${tag}`, precio_mensual: 500 });
            await inscribir(F.a1, F.comedor);
            await db.query('INSERT INTO comedor_asistencias (alumno_id, fecha, consumio_menu) VALUES ($1, $2, true), ($1, $3, false)',
                [F.a1, `${ANIO}-06-02`, `${ANIO}-06-03`]);
        });

        after(async () => {
            const alumnos = [F.a1, F.a2, F.a3, F.a4, F.a5, F.a6];
            await db.query('DELETE FROM comedor_asistencias WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM transporte_asignaciones WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`RP-%-${tag}`]);
            await db.query('DELETE FROM horarios WHERE materia_id = ANY($1)', [[F.m1, F.m2, F.m3, F.m4]]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnos]);
            await db.query('DELETE FROM materias WHERE id = ANY($1)', [[F.m1, F.m2, F.m3, F.m4]]);
            await db.query('DELETE FROM cursos WHERE id = ANY($1)', [[F.c1, F.c2]]);
        });

        it('solo el administrador accede a los reportes', async () => {
            assert.equal((await api('GET', '/api/reportes')).status, 403);
            for (const t of [tokens.padre, tokens.docente, tokens.alumno]) {
                assert.equal((await get('', t)).status, 403);
                assert.equal((await get('/alumnos-por-curso', t)).status, 403);
                assert.equal((await get(`/alumno/${F.a1}`, t)).status, 403);
            }
            assert.equal((await get('')).status, 200);
        });

        it('el catálogo lista los 9 reportes y las opciones traen lo necesario para los filtros', async () => {
            const cat = await get('');
            assert.equal(cat.data.length, 9);
            const op = await get('/opciones');
            assert.equal(op.status, 200);
            for (const clave of ['niveles', 'cursos', 'materias', 'docentes', 'deportes', 'rutas', 'alumnos']) {
                assert.ok(Array.isArray(op.data[clave]), clave);
            }
            assert.ok(op.data.alumnos.some(a => a.legajo === leg(F.a1)));
            assert.ok(!op.data.alumnos.some(a => a.legajo === leg(F.a4)), 'un alumno inactivo no se ofrece');
        });

        it('alumnos por curso: nivel, curso, legajo, apellido y nombre, solo activos y con curso', async () => {
            const r = await get(`/alumnos-por-curso?curso_id=${F.c1}`);
            assert.equal(r.status, 200);
            assert.deepEqual(r.data.secciones[0].columnas.map(c => c.clave), ['nivel', 'curso', 'legajo', 'apellido', 'nombre']);
            const legajos = filas(r).map(x => x.legajo);
            assert.deepEqual(legajos, [leg(F.a1), leg(F.a2)], 'ordenados por apellido, sin el inactivo ni el que no tiene curso');
            assert.ok(filas(r).every(x => x.curso === `R1-${tag}`));
            assert.equal((await get('/alumnos-por-curso?curso_id=abc')).status, 400);
        });

        it('alumnos por materia: con su profesor a cargo, o aviso si no tiene', async () => {
            const r = await get(`/alumnos-por-materia?curso_id=${F.c1}`);
            assert.equal(r.status, 200);
            assert.deepEqual(r.data.secciones[0].columnas.map(c => c.clave), ['nivel', 'curso', 'materia', 'profesor', 'alumno', 'legajo']);
            const porMateria = (nombre) => filas(r).filter(x => x.materia === `${nombre} ${tag}`);
            assert.equal(porMateria('Matemática').length, 2, 'A1 y A2 (el inactivo no)');
            assert.match(porMateria('Matemática')[0].profesor, /^Uno/);
            assert.match(porMateria('Lengua')[0].profesor, /^Dos/);
            assert.equal(porMateria('Sin profesor')[0].profesor, 'Sin profesor asignado');
            const una = await get(`/alumnos-por-materia?materia_id=${F.m3}`);
            assert.deepEqual(filas(una).map(x => x.legajo).sort(), [leg(F.a3), leg(F.a6)].sort(), 'A3 y A6 cursan Historia (curso 2)');
        });

        it('docentes por nivel: materias a cargo y cursos', async () => {
            const r = await get(`/docentes-por-nivel?nivel_id=${apoyo.nivel}`);
            assert.equal(r.status, 200);
            const uno = filas(r).find(x => x.profesor.startsWith('Uno'));
            assert.equal(uno.nivel, (await db.query('SELECT nombre FROM niveles WHERE id = $1', [apoyo.nivel])).rows[0].nombre);
            assert.equal(uno.materias, `Matemática ${tag}`);
            assert.equal(uno.cursos, `R1-${tag}`);
            const dos = filas(r).find(x => x.profesor.startsWith('Dos'));
            assert.equal(dos.materias, `Lengua ${tag}`);
            const otro = await get(`/docentes-por-nivel?nivel_id=${apoyo.nivel2}`);
            const unoN2 = filas(otro).find(x => x.profesor.startsWith('Uno'));
            assert.equal(unoN2.materias, `Historia ${tag}`);
        });

        it('por docente: sus cursos por nivel y los horarios de cada curso', async () => {
            const r = await get(`/docente/${apoyo.docente}`);
            assert.equal(r.status, 200);
            const [datos, cursos, horarios] = r.data.secciones;
            assert.equal(datos.filas[0].legajo, `D-${String(apoyo.docente).padStart(5, '0')}`);
            assert.equal(cursos.filas.length, 2, 'un curso en cada nivel');
            assert.deepEqual(horarios.filas.map(h => [h.materia, h.dia, h.inicio, h.fin]), [
                [`Matemática ${tag}`, 'Lunes', '08:00', '09:30'],
                [`Historia ${tag}`, 'Miércoles', '10:00', '11:00'],
            ]);
            assert.equal((await get('/docente/2147483000')).status, 404);
            const admin = await nuevoDocente('Admin', { tipo: 'Administrativo' });
            assert.equal((await get(`/docente/${admin}`)).status, 404, 'solo los docentes tienen este reporte');
            assert.equal((await get('/docente/abc')).status, 400);
        });

        it('por alumno: curso, materias y profesores, deportes con horario, transporte y comedor', async () => {
            const r = await get(`/alumno/${F.a1}?${periodo}`);
            assert.equal(r.status, 200);
            const [datos, materias, deportes, transporte, comedor] = r.data.secciones;
            assert.equal(datos.filas[0].legajo, leg(F.a1));
            assert.equal(datos.filas[0].curso, `R1-${tag}`);
            assert.deepEqual(materias.filas.map(m => m.materia), [`Lengua ${tag}`, `Matemática ${tag}`, `Sin profesor ${tag}`]);
            assert.equal(deportes.filas.length, 1);
            assert.equal(deportes.filas[0].horario, 'martes 16:00 a 17:00');
            assert.match(deportes.filas[0].profesor, /^Uno/);
            assert.equal(transporte.filas.length, 1, 'asignación e inscripción del mismo recorrido cuentan una vez');
            assert.equal(transporte.filas[0].punto, 'Plaza Central');
            assert.equal(transporte.filas[0].origen, 'Asignación');
            assert.deepEqual(comedor.filas[0], { inscripto: 'Sí', consumidos: 1, registrados: 2 });
        });

        it('por alumno: sin curso ni servicios los datos quedan vacíos y no falla', async () => {
            const r = await get(`/alumno/${F.a5}?${periodo}`);
            const [datos, materias, deportes, transporte, comedor] = r.data.secciones;
            assert.equal(datos.filas[0].curso, 'Sin curso');
            assert.equal(materias.filas.length, 0);
            assert.equal(deportes.filas.length, 1, 'A5 sí está en un deporte');
            assert.equal(transporte.filas.length, 0);
            assert.equal(comedor.filas[0].inscripto, 'No');
            assert.equal((await get('/alumno/2147483000')).status, 404);
            assert.equal((await get(`/alumno/${F.a1}?mes=13&anio=${ANIO}`)).status, 400);
        });

        it('alumnos por deporte: del mes pedido, sin las bajas', async () => {
            const r = await get(`/alumnos-por-deporte?actividad_id=${F.actividad1}&${periodo}`);
            assert.deepEqual(r.data.secciones[0].columnas.map(c => c.clave), ['deporte', 'alumno', 'curso', 'nivel_alumno']);
            assert.deepEqual(filas(r).map(x => x.alumno), ['Aguirre, Rep', 'Benitez, Rep']);
            const otroMes = await get(`/alumnos-por-deporte?actividad_id=${F.actividad1}&mes=${MES + 1}&anio=${ANIO}`);
            assert.equal(filas(otroMes).length, 0, 'las inscripciones son mensuales');

            await api('DELETE', `/api/inscripciones/${F.i2}`, { token: tokens.admin });
            const sinBaja = await get(`/alumnos-por-deporte?actividad_id=${F.actividad1}&${periodo}`);
            assert.deepEqual(filas(sinBaja).map(x => x.alumno), ['Aguirre, Rep']);
        });

        it('alumnos por deporte y nivel, y con horario y profesor', async () => {
            const nivel2 = await get(`/alumnos-por-deporte-y-nivel?nivel_id=${apoyo.nivel2}&${periodo}`);
            assert.deepEqual(nivel2.data.secciones[0].columnas.map(c => c.clave), ['deporte', 'nivel_grupo', 'alumno', 'curso']);
            const nombres = filas(nivel2).map(x => x.alumno);
            assert.ok(nombres.includes('Cabral, Rep') && nombres.includes('Echeverria, Rep'));
            assert.ok(!nombres.includes('Aguirre, Rep'), 'el grupo del nivel 1 no entra');

            const completo = await get(`/alumnos-por-deporte-nivel-horario?actividad_id=${F.actividad1}&${periodo}`);
            assert.deepEqual(completo.data.secciones[0].columnas.map(c => c.clave), ['deporte', 'nivel_grupo', 'horario', 'profesor', 'alumno', 'curso']);
            const fila = filas(completo)[0];
            assert.equal(fila.horario, 'martes 16:00 a 17:00');
            assert.match(fila.profesor, /^Uno/);
            assert.equal(fila.alumno, 'Aguirre, Rep');
        });

        it('alumnos por recorrido: asignaciones e inscripciones del mes, sin repetir', async () => {
            const r = await get(`/alumnos-por-recorrido?ruta_id=${F.ruta}&${periodo}`);
            assert.deepEqual(r.data.secciones[0].columnas.map(c => c.clave), ['recorrido', 'chofer', 'alumno', 'nivel', 'curso', 'punto', 'origen']);
            const porAlumno = Object.fromEntries(filas(r).map(x => [x.alumno, x]));
            assert.equal(filas(r).length, 2);
            assert.equal(porAlumno['Aguirre, Rep'].origen, 'Asignación');
            assert.equal(porAlumno['Aguirre, Rep'].punto, 'Plaza Central');
            assert.equal(porAlumno['Benitez, Rep'].origen, 'Inscripción del mes');
            assert.equal(porAlumno['Benitez, Rep'].punto, '-');
            const otra = await get(`/alumnos-por-recorrido?ruta_id=${F.ruta2}&${periodo}`);
            assert.deepEqual(filas(otra).map(x => x.alumno), ['Cabral, Rep']);
        });

        it('se puede descargar en CSV, con los acentos y sin fórmulas peligrosas', async () => {
            const res = await http('GET', `/api/reportes/alumnos-por-curso?curso_id=${F.c2}&formato=csv`, { token: tokens.admin });
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /text\/csv/);
            assert.match(res.headers.get('content-disposition'), /alumnos-por-curso_\d{4}-\d{2}-\d{2}\.csv/);
            // fetch descarta el BOM al leer el texto: se comprueban los bytes de la respuesta
            const bytes = new Uint8Array(await res.arrayBuffer());
            assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'lleva BOM para Excel');
            const texto = new TextDecoder('utf-8').decode(bytes);
            assert.ok(texto.includes('Nivel educativo,Curso,Legajo,Apellido,Nombre'));
            assert.ok(texto.includes(`${leg(F.a3)},Cabral,Rep`));
            assert.ok(texto.includes("'=Evil"), 'la fórmula queda neutralizada');
            assert.ok(!/(^|,)=Evil/m.test(texto));

            const solo = await http('GET', `/api/reportes/alumnos-por-curso?formato=csv`, { token: tokens.padre });
            assert.equal(solo.status, 403, 'el CSV tiene la misma seguridad');
        });
    });

    describe('Vínculos de cuentas y vistas del portal (ARTE-2, Sprint C)', () => {
        const tag = String(Date.now());
        const PASS = 'Inicial1!x';
        const F = {};
        const cuentas = {};
        const alumnosCreados = [];

        const crearCuenta = async (clave, rol) => {
            const username = `vc-${clave}-${tag}`;
            const r = await api('POST', '/api/auth/users', { token: tokens.admin, body: { nombre: 'Cuenta Vinculos', username, password: PASS, rol } });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            await login(username, PASS);
            cuentas[clave] = { id: r.data.id, username };
        };
        const tk = (clave) => tokens[cuentas[clave].username];
        const curso = async (division, cupo) => (await db.query(
            'INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, $3) RETURNING id', [apoyo.nivel, `${division}-${tag}`, cupo])).rows[0].id;
        const materia = async (nombre, cursoId) => (await db.query(
            'INSERT INTO materias (nombre, curso_id) VALUES ($1, $2) RETURNING id', [`${nombre} ${tag}`, cursoId])).rows[0].id;
        const horario = (materiaId, docenteId, dia, ini, fin) => db.query(
            'INSERT INTO horarios (materia_id, docente_id, aula_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, (SELECT id FROM aulas ORDER BY id LIMIT 1), $3, $4, $5)',
            [materiaId, docenteId, dia, ini, fin]);
        const alumno = async (apellido, cursoId, tutor = null, estado = 'Activo') => {
            const id = (await db.query(
                `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado)
                 VALUES ('Vin', $1, $2, '2015-05-05', $3, $4, $5) RETURNING id`,
                [apellido, dniUnico(), cursoId, tutor ? cuentas[tutor].id : null, estado])).rows[0].id;
            alumnosCreados.push(id);
            return id;
        };
        const vincular = (tipo, id, user_id, token = tokens.admin) => api('PUT', `/api/vinculos/${tipo}/${id}`, { token, body: { user_id } });
        const cursoDeAlumno = async (id) => (await db.query('SELECT curso_id FROM alumnos WHERE id = $1', [id])).rows[0].curso_id;
        const inscribirCurso = (alumnoId, cursoId, quien = 'pad1') => api('POST', `/api/academico/mis-hijos/${alumnoId}/inscribir-curso`, { token: tk(quien), body: { curso_id: cursoId } });
        const titulos = (r) => r.data.secciones.map(s => s.titulo);

        before(async () => {
            for (const [clave, rol] of [['doc1', 'docente'], ['doc2', 'docente'], ['alu', 'alumno'], ['pad1', 'padre'], ['pad2', 'padre']]) {
                await crearCuenta(clave, rol);
            }
            F.c1 = await curso('V1', 30);
            F.c2 = await curso('V2', 30);
            F.cLleno = await curso('V3', 1);
            F.cUno = await curso('V4', 1);
            F.m1 = await materia('Matemática', F.c1);
            F.m2 = await materia('Lengua', F.c2);
            F.d1 = await nuevoDocente('VincUno');
            F.d2 = await nuevoDocente('VincDos');
            F.dAdm = await nuevoDocente('VincAdm', { tipo: 'Administrativo' });
            await horario(F.m1, F.d1, 1, '08:00', '09:30');
            await horario(F.m2, F.d2, 2, '10:00', '11:00');

            F.aC1 = await alumno('Aguirre', F.c1);
            F.aC2 = await alumno('Benitez', F.c2);
            F.aLleno = await alumno('Cabral', F.cLleno);
            F.hijoConCurso = await alumno('Dominguez', F.c1, 'pad1');
            F.hijoA = await alumno('Echeverria', null, 'pad1');
            F.hijoC = await alumno('Fernandez', null, 'pad1');
            F.hijoInactivo = await alumno('Gimenez', null, 'pad1', 'Inactivo');
            F.hijoB = await alumno('Herrera', null, 'pad2');
            F.carrera1 = await alumno('Ibarra', null, 'pad1');
            F.carrera2 = await alumno('Juarez', null, 'pad2');
        });

        after(async () => {
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM horarios WHERE materia_id = ANY($1)', [[F.m1, F.m2]]);
            await db.query('DELETE FROM materias WHERE id = ANY($1)', [[F.m1, F.m2]]);
            await db.query('DELETE FROM cursos WHERE id = ANY($1)', [[F.c1, F.c2, F.cLleno, F.cUno]]);
            for (const c of Object.values(cuentas)) await api('DELETE', `/api/auth/users/${c.id}`, { token: tokens.admin });
        });

        // Las pruebas siguen un orden: primero el docente sin vincular, después los vínculos y al final lo que depende de ellos.
        it('solo el administrador gestiona los vínculos', async () => {
            assert.equal((await api('GET', '/api/vinculos')).status, 403);
            for (const t of [tokens.docente, tokens.padre, tokens.alumno]) {
                assert.equal((await api('GET', '/api/vinculos', { token: t })).status, 403);
                assert.equal((await vincular('docentes', F.d1, cuentas.doc1.id, t)).status, 403);
                assert.equal((await vincular('alumnos', F.aC1, cuentas.alu.id, t)).status, 403);
            }
            assert.equal((await api('GET', '/api/vinculos', { token: tokens.admin })).status, 200);
        });

        it('un docente sin vincular no queda sin pantalla: mantiene la lista completa mientras tanto', async () => {
            const mis = await api('GET', '/api/academico/mis-cursos', { token: tk('doc1') });
            assert.equal(mis.status, 200);
            assert.deepEqual(mis.data, { vinculado: false });
            const alumnos = await api('GET', '/api/academico/alumnos', { token: tk('doc1') });
            const ids = alumnos.data.map(a => a.id);
            assert.ok(ids.includes(F.aC1) && ids.includes(F.aC2));
            const materias = await api('GET', '/api/academico/materias', { token: tk('doc1') });
            assert.ok(materias.data.some(m => m.id === F.m1) && materias.data.some(m => m.id === F.m2));
        });

        it('la lista de vínculos trae alumnos, docentes y cuentas libres', async () => {
            const r = await api('GET', '/api/vinculos', { token: tokens.admin });
            assert.equal(r.status, 200);
            const alumno = r.data.alumnos.find(a => a.id === F.aC1);
            assert.equal(alumno.user_id, null);
            assert.equal(alumno.legajo, `A-${String(F.aC1).padStart(5, '0')}`);
            assert.equal(r.data.docentes.find(d => d.id === F.d1).legajo, `D-${String(F.d1).padStart(5, '0')}`);
            assert.ok(!r.data.docentes.some(d => d.id === F.dAdm), 'el personal que no es docente no aparece');
            const libres = r.data.cuentas_libres;
            assert.equal(libres.find(c => c.id === cuentas.doc1.id).rol, 'docente');
            assert.equal(libres.find(c => c.id === cuentas.alu.id).rol, 'alumno');
            assert.ok(!libres.some(c => c.id === cuentas.pad1.id), 'las cuentas de padre no se vinculan a legajos');
        });

        it('rechaza vínculos inválidos', async () => {
            assert.equal((await vincular('docentes', F.d1, cuentas.alu.id)).status, 400, 'cuenta de alumno a un docente');
            assert.equal((await vincular('alumnos', F.aC1, cuentas.doc1.id)).status, 400, 'cuenta de docente a un alumno');
            assert.equal((await vincular('docentes', F.d1, cuentas.pad1.id)).status, 400, 'cuenta de padre a un docente');
            assert.equal((await vincular('docentes', F.d1, 987654321)).status, 404, 'cuenta inexistente');
            assert.equal((await vincular('docentes', F.d1, 'abc')).status, 400, 'identificador inválido');
            assert.equal((await vincular('docentes', 987654321, cuentas.doc1.id)).status, 404, 'legajo inexistente');
            assert.equal((await vincular('docentes', F.dAdm, cuentas.doc1.id)).status, 404, 'personal que no es docente');
            assert.equal((await vincular('alumnos', 'x', cuentas.alu.id)).status, 400, 'legajo inválido');
        });

        it('vincula docentes y alumnos, y una cuenta no puede quedar en dos legajos', async () => {
            const a = await vincular('docentes', F.d1, cuentas.doc1.id);
            assert.equal(a.status, 200);
            assert.equal(a.data.username, cuentas.doc1.username);
            assert.equal((await vincular('docentes', F.d2, cuentas.doc1.id)).status, 409, 'la cuenta ya es de otro docente');
            assert.equal((await vincular('docentes', F.d2, cuentas.doc2.id)).status, 200);
            assert.equal((await vincular('alumnos', F.aC1, cuentas.alu.id)).status, 200);

            const lista = await api('GET', '/api/vinculos', { token: tokens.admin });
            assert.equal(lista.data.docentes.find(d => d.id === F.d1).user_id, cuentas.doc1.id);
            assert.equal(lista.data.alumnos.find(x => x.id === F.aC1).username, cuentas.alu.username);
            assert.ok(!lista.data.cuentas_libres.some(c => [cuentas.doc1.id, cuentas.doc2.id, cuentas.alu.id].includes(c.id)), 'ya no están libres');
        });

        it('desvincular libera la cuenta para asignarla de nuevo', async () => {
            const baja = await vincular('docentes', F.d1, null);
            assert.equal(baja.status, 200);
            assert.equal(baja.data.user_id, null);
            const libres = (await api('GET', '/api/vinculos', { token: tokens.admin })).data.cuentas_libres;
            assert.ok(libres.some(c => c.id === cuentas.doc1.id));
            assert.deepEqual((await api('GET', '/api/academico/mis-cursos', { token: tk('doc1') })).data, { vinculado: false });
            assert.equal((await vincular('docentes', F.d1, cuentas.doc1.id)).status, 200);
        });

        it('el docente vinculado ve sus cursos y horarios, y solo los suyos', async () => {
            const r = await api('GET', '/api/academico/mis-cursos', { token: tk('doc1') });
            assert.equal(r.status, 200);
            assert.equal(r.data.vinculado, true);
            const ficha = r.data.ficha;
            assert.ok(ficha.titulo.startsWith('Reporte del docente: '));
            const cursosACargo = ficha.secciones[1].filas;
            assert.deepEqual(cursosACargo.map(c => c.curso), [`V1-${tag}`]);
            const horarios = ficha.secciones[2].filas;
            assert.equal(horarios.length, 1);
            assert.equal(horarios[0].materia, `Matemática ${tag}`);
            assert.equal(horarios[0].dia, 'Lunes');

            const otro = await api('GET', '/api/academico/mis-cursos', { token: tk('doc2') });
            assert.deepEqual(otro.data.ficha.secciones[1].filas.map(c => c.curso), [`V2-${tag}`]);
        });

        it('el docente vinculado solo lista a los alumnos y las materias de sus cursos', async () => {
            const alumnos = (await api('GET', '/api/academico/alumnos', { token: tk('doc1') })).data.map(a => a.id);
            assert.ok(alumnos.includes(F.aC1) && alumnos.includes(F.hijoConCurso), 've a los de su curso');
            assert.ok(!alumnos.includes(F.aC2) && !alumnos.includes(F.aLleno), 'no ve a los de otros cursos');
            const materias = (await api('GET', '/api/academico/materias', { token: tk('doc1') })).data.filter(m => m.nombre.endsWith(tag));
            assert.deepEqual(materias.map(m => m.id), [F.m1]);

            const alumnos2 = (await api('GET', '/api/academico/alumnos', { token: tk('doc2') })).data.map(a => a.id);
            assert.ok(alumnos2.includes(F.aC2) && !alumnos2.includes(F.aC1));
            // El administrador sigue viendo todo
            const todos = (await api('GET', '/api/academico/alumnos', { token: tokens.admin })).data.map(a => a.id);
            assert.ok(todos.includes(F.aC1) && todos.includes(F.aC2) && todos.includes(F.aLleno));
        });

        it('"mis cursos" es solo para docentes', async () => {
            assert.equal((await api('GET', '/api/academico/mis-cursos')).status, 403);
            for (const t of [tokens.admin, tokens.padre, tokens.alumno]) {
                assert.equal((await api('GET', '/api/academico/mis-cursos', { token: t })).status, 403);
            }
        });

        it('el padre ve la ficha de su hijo: materias con profesor, deportes, transporte y comedor', async () => {
            const r = await api('GET', `/api/academico/mis-hijos/${F.hijoConCurso}/ficha`, { token: tk('pad1') });
            assert.equal(r.status, 200);
            assert.ok(titulos(r)[0] === 'Datos del alumno');
            assert.ok(titulos(r).includes('Materias y profesores'));
            assert.ok(titulos(r).some(t => t.startsWith('Deportes y horarios')));
            assert.ok(titulos(r).includes('Transporte'));
            assert.ok(titulos(r).some(t => t.startsWith('Comedor')));
            const materias = r.data.secciones[1].filas;
            const mat = materias.find(m => m.materia === `Matemática ${tag}`);
            assert.ok(mat.profesor.includes('VincUno'), 'muestra al profesor de la materia');
        });

        it('el padre no ve la ficha de hijos ajenos y valida los datos del pedido', async () => {
            assert.equal((await api('GET', `/api/academico/mis-hijos/${F.hijoB}/ficha`, { token: tk('pad1') })).status, 403);
            assert.equal((await api('GET', `/api/academico/mis-hijos/${F.aC1}/ficha`, { token: tk('pad1') })).status, 403, 'alumno sin tutor');
            assert.equal((await api('GET', '/api/academico/mis-hijos/abc/ficha', { token: tk('pad1') })).status, 400);
            assert.equal((await api('GET', `/api/academico/mis-hijos/${F.hijoConCurso}/ficha?mes=13&anio=2026`, { token: tk('pad1') })).status, 400);
            assert.equal((await api('GET', `/api/academico/mis-hijos/${F.hijoConCurso}/ficha?mes=5&anio=2026`, { token: tk('pad1') })).status, 200);
            for (const t of [tokens.docente, tokens.alumno, tokens.admin]) {
                assert.equal((await api('GET', `/api/academico/mis-hijos/${F.hijoConCurso}/ficha`, { token: t })).status, 403);
            }
        });

        it('lista los cursos con sus vacantes, solo para padres', async () => {
            const r = await api('GET', '/api/academico/cursos-disponibles', { token: tk('pad1') });
            assert.equal(r.status, 200);
            const lleno = r.data.find(c => c.id === F.cLleno);
            const uno = r.data.find(c => c.id === F.cUno);
            assert.equal(lleno.vacantes, 0);
            assert.equal(uno.vacantes, 1);
            assert.equal(uno.cupo, 1);
            assert.ok(uno.nivel_nombre);
            for (const t of [tokens.docente, tokens.alumno]) {
                assert.equal((await api('GET', '/api/academico/cursos-disponibles', { token: t })).status, 403);
            }
        });

        it('el padre inscribe a su hijo al cursado', async () => {
            const antes = (await api('GET', '/api/academico/cursos-disponibles', { token: tk('pad1') })).data.find(c => c.id === F.c2);
            const r = await inscribirCurso(F.hijoA, F.c2);
            assert.equal(r.status, 200, JSON.stringify(r.data));
            assert.equal(await cursoDeAlumno(F.hijoA), F.c2);
            const despues = (await api('GET', '/api/academico/cursos-disponibles', { token: tk('pad1') })).data.find(c => c.id === F.c2);
            assert.equal(despues.vacantes, antes.vacantes - 1);
            // y ahora la ficha del hijo ya muestra las materias de ese curso
            const ficha = await api('GET', `/api/academico/mis-hijos/${F.hijoA}/ficha`, { token: tk('pad1') });
            assert.ok(ficha.data.secciones[1].filas.some(m => m.materia === `Lengua ${tag}`));
        });

        it('no inscribe si el hijo ya tiene curso, está inactivo o no es del padre', async () => {
            const yaTiene = await inscribirCurso(F.hijoA, F.c1);
            assert.equal(yaTiene.status, 409);
            assert.match(yaTiene.data.message, /Dirección/);
            assert.equal(await cursoDeAlumno(F.hijoA), F.c2, 'no se cambió el curso');
            assert.equal((await inscribirCurso(F.hijoConCurso, F.c2)).status, 409);
            assert.equal((await inscribirCurso(F.hijoInactivo, F.c1)).status, 409, 'alumno inactivo');
            assert.equal(await cursoDeAlumno(F.hijoInactivo), null);
            assert.equal((await inscribirCurso(F.hijoB, F.c1)).status, 403, 'hijo de otro padre');
            assert.equal(await cursoDeAlumno(F.hijoB), null);
            assert.equal((await inscribirCurso(F.aC1, F.c1)).status, 403, 'alumno sin tutor');
        });

        it('no inscribe en un curso lleno, inexistente o sin indicar', async () => {
            const lleno = await inscribirCurso(F.hijoC, F.cLleno);
            assert.equal(lleno.status, 400);
            assert.match(lleno.data.message, /vacantes/);
            assert.equal(await cursoDeAlumno(F.hijoC), null);
            assert.equal((await inscribirCurso(F.hijoC, 987654321)).status, 404);
            assert.equal((await api('POST', `/api/academico/mis-hijos/${F.hijoC}/inscribir-curso`, { token: tk('pad1'), body: {} })).status, 400);
            assert.equal((await api('POST', '/api/academico/mis-hijos/abc/inscribir-curso', { token: tk('pad1'), body: { curso_id: F.c1 } })).status, 400);
            for (const t of [tokens.docente, tokens.alumno, tokens.admin]) {
                assert.equal((await api('POST', `/api/academico/mis-hijos/${F.hijoC}/inscribir-curso`, { token: t, body: { curso_id: F.c1 } })).status, 403);
            }
        });

        it('si dos padres piden la última vacante a la vez, solo uno la consigue', async () => {
            const [a, b] = await Promise.all([inscribirCurso(F.carrera1, F.cUno, 'pad1'), inscribirCurso(F.carrera2, F.cUno, 'pad2')]);
            assert.deepEqual([a.status, b.status].sort(), [200, 400], `respuestas: ${JSON.stringify([a.data, b.data])}`);
            const n = (await db.query('SELECT COUNT(*)::int AS n FROM alumnos WHERE curso_id = $1', [F.cUno])).rows[0].n;
            assert.equal(n, 1, 'el curso no supera su cupo');
        });
    });

    describe('Portal del alumno y deportes en el sistema nuevo (ARTE-2, Sprint C2)', () => {
        const fs = require('fs');
        const path = require('path');
        const tag = String(Date.now());
        const PASS = 'Inicial1!x';
        const hoy = new Date();
        const MES = hoy.getMonth() + 1;
        const ANIO = hoy.getFullYear();
        const HOY = hoy.toLocaleDateString('en-CA');
        const F = {};
        const cuentas = {};
        const alumnosCreados = [];
        const actividades = [];

        const crearCuenta = async (clave, rol) => {
            const username = `c2-${clave}-${tag}`;
            const r = await api('POST', '/api/auth/users', { token: tokens.admin, body: { nombre: 'Cuenta Portal', username, password: PASS, rol } });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            await login(username, PASS);
            cuentas[clave] = { id: r.data.id, username };
        };
        const tk = (clave) => tokens[cuentas[clave].username];
        const actividad = async (tipo, nombre) => {
            const id = (await db.query(
                "INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, $2, 'x', 30) RETURNING id", [`C2-${tag}-${nombre}`, tipo])).rows[0].id;
            actividades.push(id);
            return id;
        };
        const alumno = async (apellido, estado = 'Activo') => {
            const id = (await db.query(
                `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, estado)
                 VALUES ('Portal', $1, $2, '2015-05-05', $3, $4) RETURNING id`, [apellido, dniUnico(), F.curso, estado])).rows[0].id;
            alumnosCreados.push(id);
            return id;
        };
        const servicio = async (body) => {
            const r = await api('POST', '/api/inscripciones/servicios', { token: tokens.admin, body: { precio_mensual: 1000, ...body } });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.id;
        };
        const grupo = (nombre, actividadId, docenteId, dia, ini, fin) => servicio({
            tipo: 'Deporte', nombre: `C2-${nombre}-${tag}`, actividad_id: actividadId, docente_id: docenteId, nivel_id: apoyo.nivel,
            dia_semana: dia, hora_inicio: ini, hora_fin: fin,
        });
        const vincular = (tipo, id, user_id) => api('PUT', `/api/vinculos/${tipo}/${id}`, { token: tokens.admin, body: { user_id } });
        const inscribir = (token, alumnoId, servicioId) => api('POST', '/api/inscripciones', { token, body: { alumno_id: alumnoId, servicio_id: servicioId, mes: MES, anio: ANIO } });
        const inscribirOk = async (token, alumnoId, servicioId) => {
            const r = await inscribir(token, alumnoId, servicioId);
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.id;
        };
        const inscriptos = (clave, actId, query = '') => api('GET', `/api/academico/actividades/${actId}/inscriptos${query}`, { token: tk(clave) });
        const asistencia = (clave, actId, alumnoId, extra = {}) => api('POST', '/api/academico/actividades/asistencia', {
            token: tk(clave), body: { actividad_id: actId, alumno_id: alumnoId, estado: 'Presente', fecha: HOY, ...extra } });
        const calificacion = (clave, actId, alumnoId, nota) => api('POST', '/api/academico/actividades/calificacion', {
            token: tk(clave), body: { actividad_id: actId, alumno_id: alumnoId, nota } });

        before(async () => {
            for (const [clave, rol] of [['alu1', 'alumno'], ['alu2', 'alumno'], ['alu3', 'alumno'], ['docA', 'docente'], ['docB', 'docente'], ['docLibre', 'docente'], ['padre', 'padre']]) {
                await crearCuenta(clave, rol);
            }
            F.curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 30) RETURNING id', [apoyo.nivel, `C2-${tag}`])).rows[0].id;
            F.dA = await nuevoDocente('PortalA');
            F.dB = await nuevoDocente('PortalB');
            F.a1 = await alumno('Aguilar');
            F.a2 = await alumno('Benitez');
            F.a3 = await alumno('Cardozo');
            F.aInactivo = await alumno('Duarte', 'Inactivo');
            assert.equal((await vincular('alumnos', F.a1, cuentas.alu1.id)).status, 200);
            assert.equal((await vincular('alumnos', F.a2, cuentas.alu2.id)).status, 200);
            assert.equal((await vincular('docentes', F.dA, cuentas.docA.id)).status, 200);
            assert.equal((await vincular('docentes', F.dB, cuentas.docB.id)).status, 200);

            F.actFutbol = await actividad('Deporte', 'Futbol');
            F.actNatacion = await actividad('Deporte', 'Natacion');
            F.actTenis = await actividad('Deporte', 'Tenis');
            F.actHockey = await actividad('Deporte', 'Hockey');
            F.actTeatro = await actividad('Cultura', 'Teatro');
            F.g1 = await grupo('Futbol', F.actFutbol, F.dA, 1, '16:00', '17:00');
            F.g2 = await grupo('Natacion', F.actNatacion, F.dA, 2, '16:00', '17:00');
            F.g3 = await grupo('Tenis', F.actTenis, F.dA, 3, '16:00', '17:00');
            F.gB = await grupo('Hockey', F.actHockey, F.dB, 4, '16:00', '17:00');
            F.gChoque = await grupo('Choque', await actividad('Deporte', 'Choque'), F.dB, 1, '16:30', '17:30');
            F.transporte = await servicio({ tipo: 'Transporte', nombre: `C2-Ruta-${tag}`, ruta_id: apoyo.rutas[0] });
            F.comedor = await servicio({ tipo: 'Comedor', nombre: `C2-Comedor-${tag}`, precio_mensual: 500 });
        });

        after(async () => {
            await db.query('DELETE FROM actividad_asistencias WHERE actividad_id = ANY($1)', [actividades]);
            await db.query('DELETE FROM actividad_calificaciones WHERE actividad_id = ANY($1)', [actividades]);
            await db.query('DELETE FROM inscripciones_extra WHERE actividad_id = ANY($1)', [actividades]);
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`C2-%-${tag}`]);
            await db.query('DELETE FROM actividades_extra WHERE id = ANY($1)', [actividades]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM cursos WHERE id = $1', [F.curso]);
            for (const c of Object.values(cuentas)) await api('DELETE', `/api/auth/users/${c.id}`, { token: tokens.admin });
        });

        describe('ficha propia y catálogo del alumno', () => {
            it('el alumno vinculado ve su propia ficha; sin vínculo, un aviso', async () => {
                const r = await api('GET', '/api/academico/mi-ficha', { token: tk('alu1') });
                assert.equal(r.status, 200);
                assert.equal(r.data.vinculado, true);
                assert.equal(r.data.alumno_id, F.a1);
                assert.equal(r.data.ficha.secciones[0].filas[0].apellido, 'Aguilar');
                assert.ok(r.data.ficha.secciones.some(s => s.titulo.startsWith('Deportes y horarios')));
                const libre = await api('GET', '/api/academico/mi-ficha', { token: tk('alu3') });
                assert.deepEqual(libre.data, { vinculado: false });
            });

            it('la ficha propia es solo para alumnos y valida el período', async () => {
                assert.equal((await api('GET', '/api/academico/mi-ficha')).status, 403);
                for (const t of [tokens.admin, tokens.padre, tokens.docente]) {
                    assert.equal((await api('GET', '/api/academico/mi-ficha', { token: t })).status, 403);
                }
                assert.equal((await api('GET', '/api/academico/mi-ficha?mes=13&anio=2026', { token: tk('alu1') })).status, 400);
            });

            it('el catálogo del alumno trae solo deportes; el del padre, todos los servicios', async () => {
                const alumnoCat = await api('GET', '/api/inscripciones/catalogo', { token: tk('alu1') });
                assert.equal(alumnoCat.status, 200);
                const ids = alumnoCat.data.servicios.map(s => s.id);
                assert.ok(ids.includes(F.g1) && ids.includes(F.gB));
                assert.ok(!ids.includes(F.transporte) && !ids.includes(F.comedor));
                assert.ok(alumnoCat.data.servicios.every(s => s.tipo === 'Deporte'));
                const familia = await api('GET', '/api/inscripciones/catalogo', { token: tokens.padre });
                assert.ok(familia.data.servicios.some(s => s.id === F.transporte) && familia.data.servicios.some(s => s.id === F.comedor));
            });
        });

        describe('el alumno gestiona sus propios deportes', () => {
            it('se inscribe a un deporte con su propio legajo y le aparece en su ficha', async () => {
                const id = await inscribirOk(tk('alu1'), F.a1, F.g1);
                const propias = await api('GET', `/api/inscripciones/alumno/${F.a1}`, { token: tk('alu1') });
                assert.equal(propias.status, 200);
                assert.ok(propias.data.some(i => i.id === id));
                const ficha = await api('GET', '/api/academico/mi-ficha', { token: tk('alu1') });
                const deportes = ficha.data.ficha.secciones.find(s => s.titulo.startsWith('Deportes y horarios')).filas;
                assert.equal(deportes.length, 1);
                assert.equal(deportes[0].grupo, `C2-Futbol-${tag}`);
                assert.match(deportes[0].horario, /lunes 16:00/);
            });

            it('no puede inscribir ni ver a otro alumno, ni una cuenta sin vincular', async () => {
                assert.equal((await inscribir(tk('alu1'), F.a2, F.g1)).status, 403, 'legajo de otro alumno');
                assert.equal((await inscribir(tk('alu1'), F.a3, F.g1)).status, 403, 'alumno sin cuenta');
                assert.equal((await api('GET', `/api/inscripciones/alumno/${F.a2}`, { token: tk('alu1') })).status, 403);
                assert.equal((await inscribir(tk('alu3'), F.a1, F.g2)).status, 403, 'cuenta sin vincular');
                assert.equal((await inscribir(tk('alu3'), F.a3, F.g2)).status, 403);
            });

            it('solo gestiona deportes: transporte y comedor los decide la familia', async () => {
                assert.equal((await inscribir(tk('alu1'), F.a1, F.transporte)).status, 403);
                assert.equal((await inscribir(tk('alu1'), F.a1, F.comedor)).status, 403);
                // una inscripción de transporte hecha por la familia tampoco la puede dar de baja el alumno
                const idTransporte = await inscribirOk(tokens.admin, F.a1, F.transporte);
                const baja = await api('DELETE', `/api/inscripciones/${idTransporte}`, { token: tk('alu1') });
                assert.equal(baja.status, 403);
                const sigue = await db.query('SELECT estado FROM inscripciones_servicio WHERE id = $1', [idTransporte]);
                assert.equal(sigue.rows[0].estado, 'Activa');
            });

            it('mantiene las reglas: máximo de deportes por mes y superposición de horarios', async () => {
                assert.equal((await inscribir(tk('alu1'), F.a1, F.gChoque)).status, 409, 'se pisa con el fútbol del lunes');
                await inscribirOk(tk('alu1'), F.a1, F.g2);
                const tercero = await inscribir(tk('alu1'), F.a1, F.g3);
                assert.equal(tercero.status, 409);
                assert.match(tercero.data.message, /máximo en 2 deportes/);
            });

            it('se da de baja de su deporte y no de los de otro alumno', async () => {
                const idDeA2 = await inscribirOk(tokens.admin, F.a2, F.g3);
                const ajena = await api('DELETE', `/api/inscripciones/${idDeA2}`, { token: tk('alu1') });
                assert.equal(ajena.status, 403);
                const propia = (await api('GET', `/api/inscripciones/alumno/${F.a1}`, { token: tk('alu1') })).data.find(i => i.servicio_id === F.g2);
                const baja = await api('DELETE', `/api/inscripciones/${propia.id}`, { token: tk('alu1') });
                assert.equal(baja.status, 200);
                const activas = (await api('GET', `/api/inscripciones/alumno/${F.a1}`, { token: tk('alu1') })).data;
                assert.ok(!activas.some(i => i.servicio_id === F.g2));
                // el resto del resumen sigue siendo solo para padres
                assert.equal((await api('GET', '/api/inscripciones/resumen-familia', { token: tk('alu1') })).status, 403);
            });
        });

        describe('el flujo anterior queda solo para Cultura e Idioma', () => {
            it('los deportes ya no se inscriben por actividad', async () => {
                const r = await api('POST', '/api/academico/inscribir-actividad', { token: tk('alu1'), body: { actividad_id: F.actFutbol } });
                assert.equal(r.status, 409);
                assert.match(r.data.message, /por grupo/);
            });

            it('Cultura e Idioma siguen funcionando, y los deportes no se listan en ese flujo', async () => {
                const r = await api('POST', '/api/academico/inscribir-actividad', { token: tk('alu1'), body: { actividad_id: F.actTeatro } });
                assert.equal(r.status, 201, JSON.stringify(r.data));
                // un registro viejo de deporte (de antes del cambio) no aparece en "mis inscripciones" ni en el listado del alumno
                await db.query('INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2)', [cuentas.alu1.id, F.actFutbol]);
                const mis = await api('GET', '/api/academico/mis-inscripciones', { token: tk('alu1') });
                assert.deepEqual(mis.data.map(a => a.id), [F.actTeatro]);
                const lista = await api('GET', '/api/academico/actividades', { token: tk('alu1') });
                assert.ok(lista.data.some(a => a.id === F.actTeatro));
                assert.ok(lista.data.every(a => a.tipo !== 'Deporte'));
                const baja = await api('DELETE', `/api/academico/desinscribir-actividad/${F.actTeatro}`, { token: tk('alu1') });
                assert.equal(baja.status, 200);
            });

            it('se retiró la inscripción que aceptaba cualquier alumno_id', async () => {
                for (const t of [tk('alu1'), tokens.padre]) {
                    const r = await api('POST', '/api/comunicacion/actividades-extra/inscribir', { token: t, body: { alumno_id: F.a2, actividad_id: F.actTeatro } });
                    assert.equal(r.status, 404);
                }
            });
        });

        describe('panel de actividades del docente con deportes por grupo', () => {
            it('el docente vinculado ve solo los deportes que dicta, con sus inscriptos del mes', async () => {
                const lista = await api('GET', '/api/academico/actividades', { token: tk('docA') });
                const propias = lista.data.filter(a => a.nombre.startsWith(`C2-${tag}`));
                const nombres = propias.map(a => a.nombre.replace(`C2-${tag}-`, '')).sort();
                assert.deepEqual(nombres, ['Futbol', 'Natacion', 'Teatro', 'Tenis'], 'sus deportes y las actividades de Cultura');
                assert.equal(propias.find(a => a.id === F.actFutbol).inscriptos, 1);
                const deB = await api('GET', '/api/academico/actividades', { token: tk('docB') });
                assert.ok(deB.data.some(a => a.id === F.actHockey) && !deB.data.some(a => a.id === F.actFutbol));
                // el administrador ve todos
                const admin = await api('GET', '/api/academico/actividades', { token: tokens.admin });
                assert.ok([F.actFutbol, F.actHockey, F.actTeatro].every(id => admin.data.some(a => a.id === id)));
            });

            it('lista a los alumnos inscriptos en sus grupos, por legajo y del mes', async () => {
                const r = await inscriptos('docA', F.actFutbol);
                assert.equal(r.status, 200);
                assert.deepEqual(r.data.map(i => [i.alumno_id, i.alumno_nombre]), [[F.a1, 'Aguilar, Portal']]);
                const otroMes = await inscriptos('docA', F.actFutbol, `?mes=${MES === 12 ? 1 : MES + 1}&anio=${MES === 12 ? ANIO + 1 : ANIO}`);
                assert.deepEqual(otroMes.data, []);
                assert.equal((await inscriptos('docA', F.actFutbol, '?mes=13&anio=2026')).status, 400);
                assert.equal((await inscriptos('docA', 987654321)).status, 404);
                assert.equal((await api('GET', '/api/academico/actividades/abc/inscriptos', { token: tk('docA') })).status, 400);
            });

            it('no muestra a quien se dio de baja ni a los alumnos inactivos', async () => {
                const idBaja = await inscribirOk(tokens.admin, F.a2, F.g1);
                assert.deepEqual((await inscriptos('docA', F.actFutbol)).data.map(i => i.alumno_id).sort(), [F.a1, F.a2].sort());
                await api('DELETE', `/api/inscripciones/${idBaja}`, { token: tokens.admin });
                await inscribirOk(tokens.admin, F.aInactivo, F.g1);
                assert.deepEqual((await inscriptos('docA', F.actFutbol)).data.map(i => i.alumno_id), [F.a1]);
            });

            it('un docente solo ve los inscriptos de sus grupos; sin vincular mantiene la vista completa', async () => {
                assert.deepEqual((await inscriptos('docB', F.actFutbol)).data, [], 'el fútbol lo dicta otro docente');
                const sinVincular = await inscriptos('docLibre', F.actFutbol);
                assert.deepEqual(sinVincular.data.map(i => i.alumno_id), [F.a1]);
            });

            it('registra la asistencia por legajo, solo de alumnos inscriptos en sus grupos', async () => {
                const ok = await asistencia('docA', F.actFutbol, F.a1);
                assert.equal(ok.status, 201, JSON.stringify(ok.data));
                const fila = (await db.query('SELECT alumno_id, legajo_id, fecha::text AS fecha, estado FROM actividad_asistencias WHERE id = $1', [ok.data.id])).rows[0];
                assert.equal(fila.legajo_id, F.a1);
                assert.equal(fila.alumno_id, null);
                assert.equal(fila.fecha, HOY);
                assert.equal(fila.estado, 'Presente');

                assert.equal((await asistencia('docA', F.actFutbol, F.a3)).status, 409, 'alumno no inscripto');
                assert.equal((await asistencia('docB', F.actFutbol, F.a1)).status, 409, 'grupo de otro docente');
                assert.equal((await asistencia('docA', F.actFutbol, F.a1, { fecha: '2030-01-15' })).status, 409, 'mes sin inscripción');
                assert.equal((await asistencia('docA', F.actFutbol, F.a1, { fecha: '2026-02-30' })).status, 400, 'fecha inexistente');
                assert.equal((await asistencia('docA', F.actFutbol, F.a1, { estado: 'Casi' })).status, 400);
                assert.equal((await asistencia('docA', 987654321, F.a1)).status, 404);
                const sinFecha = await asistencia('docA', F.actFutbol, F.a1, { fecha: undefined });
                assert.equal(sinFecha.status, 201, 'sin fecha usa hoy');
            });

            it('califica por legajo: crea, actualiza y se refleja como última nota', async () => {
                const primera = await calificacion('docA', F.actFutbol, F.a1, 7);
                assert.equal(primera.status, 201, JSON.stringify(primera.data));
                const segunda = await calificacion('docA', F.actFutbol, F.a1, 9);
                assert.equal(segunda.status, 200);
                assert.equal(segunda.data.id, primera.data.id);
                const filas = (await db.query('SELECT nota, legajo_id, alumno_id FROM actividad_calificaciones WHERE actividad_id = $1', [F.actFutbol])).rows;
                assert.deepEqual(filas, [{ nota: 9, legajo_id: F.a1, alumno_id: null }]);
                assert.equal((await inscriptos('docA', F.actFutbol)).data[0].ultima_nota, 9);

                assert.equal((await calificacion('docA', F.actFutbol, F.a3, 8)).status, 409, 'no inscripto');
                assert.equal((await calificacion('docB', F.actFutbol, F.a1, 8)).status, 409, 'grupo de otro docente');
                assert.equal((await calificacion('docA', F.actFutbol, F.a1, 11)).status, 400);
                assert.equal((await calificacion('docA', F.actFutbol, F.a1, 'diez')).status, 400);
                assert.equal((await calificacion('docA', 987654321, F.a1, 8)).status, 404);
            });

            it('Cultura e Idioma siguen con el sistema anterior (por cuenta de alumno)', async () => {
                const id = await api('POST', '/api/academico/inscribir-actividad', { token: tk('alu2'), body: { actividad_id: F.actTeatro } });
                assert.equal(id.status, 201);
                const lista = await inscriptos('docA', F.actTeatro);
                assert.equal(lista.status, 200);
                assert.deepEqual(lista.data.map(i => i.alumno_id), [cuentas.alu2.id]);
                const ok = await asistencia('docA', F.actTeatro, cuentas.alu2.id);
                assert.equal(ok.status, 201);
                const fila = (await db.query('SELECT alumno_id, legajo_id FROM actividad_asistencias WHERE id = $1', [ok.data.id])).rows[0];
                assert.equal(fila.alumno_id, cuentas.alu2.id);
                assert.equal(fila.legajo_id, null);
                assert.equal((await calificacion('docA', F.actTeatro, cuentas.alu2.id, 6)).status, 201);
            });
        });

        describe('migración de los registros viejos', () => {
            it('completa legajo_id con el legajo de la cuenta vinculada, sin tocar el resto y sin duplicar al repetirse', async () => {
                const schema = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');
                const vieja = (await db.query(
                    "INSERT INTO actividad_asistencias (actividad_id, alumno_id, fecha, estado) VALUES ($1, $2, $3, 'Tarde') RETURNING id",
                    [F.actTeatro, cuentas.alu1.id, HOY])).rows[0].id;
                const sinCuenta = (await db.query(
                    "INSERT INTO actividad_asistencias (actividad_id, alumno_id, fecha, estado) VALUES ($1, $2, $3, 'Tarde') RETURNING id",
                    [F.actTeatro, cuentas.alu3.id, HOY])).rows[0].id;
                const totalAntes = (await db.query('SELECT COUNT(*)::int AS n FROM actividad_asistencias')).rows[0].n;

                await db.query(schema);
                await db.query(schema); // se ejecuta en cada arranque: tiene que poder repetirse

                const filas = (await db.query('SELECT id, alumno_id, legajo_id FROM actividad_asistencias WHERE id = ANY($1) ORDER BY id', [[vieja, sinCuenta]])).rows;
                assert.deepEqual(filas, [
                    { id: vieja, alumno_id: cuentas.alu1.id, legajo_id: F.a1 },
                    { id: sinCuenta, alumno_id: cuentas.alu3.id, legajo_id: null },
                ]);
                assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM actividad_asistencias')).rows[0].n, totalAntes, 'no se borró ni se duplicó nada');
            });
        });
    });

    describe('Reglas sueltas: legajo, unicidad, transporte y comedor (ARTE-2, Sprint D)', () => {
        const fs = require('fs');
        const path = require('path');
        const { legajoAlumnoSql } = require('../src/utils/reportes');
        const tag = String(Date.now());
        const PASS = 'Inicial1!x';
        const hoy = new Date();
        const MES = hoy.getMonth() + 1;
        const ANIO = hoy.getFullYear();
        const F = {};
        const alumnosCreados = [];
        const cursosCreados = [];
        const serviciosCreados = [];
        const leg = (prefijo, id) => `${prefijo}-${String(id).padStart(5, '0')}`;

        const alumno = async (apellido, estado = 'Activo', cursoId = F.curso) => {
            const id = (await db.query(
                `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, estado)
                 VALUES ('Regla', $1, $2, '2015-05-05', $3, $4) RETURNING id`, [apellido, dniUnico(), cursoId, estado])).rows[0].id;
            alumnosCreados.push(id);
            return id;
        };
        const asignar = (alumno_id, ruta_id, punto_encuentro, token = tokens.admin) =>
            api('POST', '/api/servicios/transporte/asignar', { token, body: { alumno_id, ruta_id, punto_encuentro } });
        const rutaDesdeApi = async (id) => (await api('GET', '/api/servicios/transporte/rutas', { token: tokens.admin })).data.find(r => r.id === id);
        const comedor = (body, token = tokens.docente) => api('POST', '/api/servicios/comedor/asistencia', { token, body });
        const codigoDeError = async (promesa) => { try { await promesa; return null; } catch (e) { return e.code; } };

        before(async () => {
            F.curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 40) RETURNING id', [apoyo.nivel, `D-${tag}`])).rows[0].id;
            cursosCreados.push(F.curso);
            F.ruta = apoyo.rutas[apoyo.rutas.length - 1];
            F.rutaOtra = apoyo.rutas[0];
            F.capacidadOriginal = (await db.query('SELECT capacidad_max FROM transporte_rutas WHERE id = $1', [F.ruta])).rows[0].capacidad_max;
            // El recorrido tiene que tener su servicio de transporte para probar que los inscriptos del mes también ocupan lugar.
            let servicio = (await db.query("SELECT id FROM servicios WHERE tipo = 'Transporte' AND ruta_id = $1 LIMIT 1", [F.ruta])).rows[0];
            if (!servicio) {
                servicio = (await db.query(
                    "INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Transporte', $1, 1000, $2) RETURNING id", [`D-Ruta-${tag}`, F.ruta])).rows[0];
                serviciosCreados.push(servicio.id);
            }
            F.servicioRuta = servicio.id;
            F.ocupadosInicial = (await rutaDesdeApi(F.ruta)).ocupados;
            F.aTransp = await alumno('Aranda');
            F.bTransp = await alumno('Bustos');
            F.cTransp = await alumno('Cuello');
            F.inactivo = await alumno('Dorrego', 'Inactivo');
            F.viajero = await alumno('Escalante');
            F.comedor = await alumno('Fuentes');
            F.dup = await alumno('Garay');
        });

        after(async () => {
            await db.query('UPDATE transporte_rutas SET capacidad_max = $1 WHERE id = $2', [F.capacidadOriginal, F.ruta]);
            await db.query('DELETE FROM comedor_asistencias WHERE alumno_id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM transporte_asignaciones WHERE alumno_id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM materias WHERE curso_id = ANY($1)', [cursosCreados]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [alumnosCreados]);
            await db.query('DELETE FROM cursos WHERE id = ANY($1)', [cursosCreados]);
            if (serviciosCreados.length) await db.query('DELETE FROM servicios WHERE id = ANY($1)', [serviciosCreados]);
        });

        describe('legajo', () => {
            it('los listados traen el legajo con el mismo formato que los reportes', async () => {
                const alumnos = await api('GET', '/api/academico/alumnos', { token: tokens.admin });
                assert.equal(alumnos.data.find(a => a.id === F.aTransp).legajo, leg('A', F.aTransp));

                const docenteId = await nuevoDocente('LegajoDoc');
                const administrativoId = await nuevoDocente('LegajoAdm', { tipo: 'Administrativo' });
                const personal = (await api('GET', '/api/financiero/personal', { token: tokens.admin })).data;
                assert.equal(personal.find(p => p.id === docenteId).legajo, leg('D', docenteId), 'los docentes llevan D');
                assert.equal(personal.find(p => p.id === administrativoId).legajo, leg('P', administrativoId), 'el resto del personal lleva P');

                const disponibles = await api('GET', '/api/academico/alumnos-disponibles', { token: tokens.padre });
                assert.equal(disponibles.data.find(a => a.id === F.aTransp).legajo, leg('A', F.aTransp));
            });

            it('el legajo de un hijo vinculado se ve en "mis hijos"', async () => {
                await db.query('UPDATE alumnos SET tutor_id = $1 WHERE id = $2', [users.padre.id, F.aTransp]);
                try {
                    const hijos = await api('GET', '/api/academico/mis-hijos', { token: tokens.padre });
                    assert.equal(hijos.data.find(h => h.id === F.aTransp).legajo, leg('A', F.aTransp));
                } finally {
                    await db.query('UPDATE alumnos SET tutor_id = NULL WHERE id = $1', [F.aTransp]);
                }
            });

            it('con muchas cifras el legajo no se recorta', async () => {
                const sql = async (id) => (await db.query(`SELECT ${legajoAlumnoSql(String(id))} AS l`)).rows[0].l;
                assert.equal(await sql(12), 'A-00012');
                assert.equal(await sql(99999), 'A-99999');
                assert.equal(await sql(123456), 'A-123456');
            });
        });

        describe('cursos y materias sin repetir', () => {
            it('un curso no se repite dentro del nivel, aunque cambien mayúsculas o espacios', async () => {
                const crear = (division, nivel_id = apoyo.nivel) => api('POST', '/api/academico/cursos', { token: tokens.admin, body: { nivel_id, division, cupo: 20 } });
                const primero = await crear(`Z${tag}`);
                assert.equal(primero.status, 201, JSON.stringify(primero.data));
                cursosCreados.push(primero.data.id);
                for (const repetido of [`Z${tag}`, `z${tag}`, `  Z${tag} `]) {
                    const r = await crear(repetido);
                    assert.equal(r.status, 409, `"${repetido}" debería rechazarse`);
                    assert.match(r.data.message, /esa división/);
                }
                const otroNivel = await crear(`Z${tag}`, apoyo.nivel2);
                assert.equal(otroNivel.status, 201, 'la misma división en otro nivel sí se permite');
                cursosCreados.push(otroNivel.data.id);
                assert.equal((await crear(`Y${tag}`, 987654321)).status, 404, 'nivel inexistente');
                assert.equal((await crear('   ')).status, 400, 'división en blanco');
            });

            it('una materia no se repite dentro del curso, pero sí puede estar en otro', async () => {
                const crear = (nombre, curso_id = F.curso) => api('POST', '/api/academico/materias', { token: tokens.admin, body: { nombre, curso_id } });
                const primera = await crear('Geografia');
                assert.equal(primera.status, 201, JSON.stringify(primera.data));
                for (const repetida of ['Geografia', 'geografia', ' GEOGRAFIA ']) {
                    assert.equal((await crear(repetida)).status, 409, `"${repetida}" debería rechazarse`);
                }
                const otroCurso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [apoyo.nivel, `DM-${tag}`])).rows[0].id;
                cursosCreados.push(otroCurso);
                assert.equal((await crear('Geografia', otroCurso)).status, 201);
                assert.equal((await crear('Historia', 987654321)).status, 404, 'curso inexistente');
            });
        });

        describe('la base rechaza los duplicados', () => {
            it('cada tabla del flujo web tiene su restricción única', async () => {
                const cuenta = (await api('POST', '/api/auth/users', { token: tokens.admin, body: { nombre: 'Cuenta Unica', username: `d-uq-${tag}`, password: PASS, rol: 'alumno' } })).data.id;
                const actividad = (await db.query("INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, 'Cultura', 'x', 10) RETURNING id", [`D-${tag}-Uq`])).rows[0].id;
                const materia = (await db.query('INSERT INTO materias (nombre, curso_id) VALUES ($1, $2) RETURNING id', [`Unica ${tag}`, F.curso])).rows[0].id;
                try {
                    const casos = [
                        ['inscripciones_extra', 'INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2)', [cuenta, actividad]],
                        ['transporte_asignaciones', 'INSERT INTO transporte_asignaciones (alumno_id, ruta_id) VALUES ($1, $2)', [F.dup, F.ruta]],
                        ['comedor_asistencias', 'INSERT INTO comedor_asistencias (alumno_id, fecha) VALUES ($1, $2)', [F.dup, '2031-03-03']],
                        ['calificaciones', 'INSERT INTO calificaciones (alumno_id, materia_id, nota, trimestre) VALUES ($1, $2, 7, 1)', [F.dup, materia]],
                        ['cursos', 'INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 5)', [apoyo.nivel, `DU-${tag}`]],
                        ['materias', 'INSERT INTO materias (nombre, curso_id) VALUES ($1, $2)', [`Mat ${tag}`, F.curso]],
                    ];
                    for (const [tabla, sql, params] of casos) {
                        const primero = await db.query(`${sql} RETURNING id`, params);
                        if (tabla === 'cursos') cursosCreados.push(primero.rows[0].id);
                        // el duplicado cambia mayúsculas en cursos y materias: la restricción compara sin distinguirlas
                        const repetido = (tabla === 'cursos' || tabla === 'materias') ? params.map(p => (typeof p === 'string' ? p.toUpperCase() : p)) : params;
                        assert.equal(await codigoDeError(db.query(sql, repetido)), '23505', `${tabla} debería rechazar el duplicado`);
                    }
                    const rutaNombre = (await db.query('SELECT nombre_ruta FROM transporte_rutas WHERE id = $1', [F.ruta])).rows[0].nombre_ruta;
                    assert.equal(await codigoDeError(db.query('INSERT INTO transporte_rutas (nombre_ruta, capacidad_max) VALUES ($1, 5)', [rutaNombre.toUpperCase()])), '23505', 'transporte_rutas');
                } finally {
                    await db.query('DELETE FROM inscripciones_extra WHERE alumno_id = $1', [cuenta]);
                    await db.query('DELETE FROM calificaciones WHERE alumno_id = $1', [F.dup]);
                    await db.query('DELETE FROM transporte_asignaciones WHERE alumno_id = $1', [F.dup]);
                    await db.query('DELETE FROM comedor_asistencias WHERE alumno_id = $1', [F.dup]);
                    await db.query('DELETE FROM actividades_extra WHERE id = $1', [actividad]);
                    await db.query('DELETE FROM materias WHERE id = $1', [materia]);
                    await api('DELETE', `/api/auth/users/${cuenta}`, { token: tokens.admin });
                }
            });

            it('dos pedidos simultáneos de inscripción a una actividad: solo uno entra', async () => {
                const cuenta = await api('POST', '/api/auth/users', { token: tokens.admin, body: { nombre: 'Cuenta Carrera', username: `d-car-${tag}`, password: PASS, rol: 'alumno' } });
                await login(`d-car-${tag}`, PASS);
                const token = tokens[`d-car-${tag}`];
                const actividad = (await db.query("INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, 'Cultura', 'x', 10) RETURNING id", [`D-${tag}-Car`])).rows[0].id;
                try {
                    const pedir = () => api('POST', '/api/academico/inscribir-actividad', { token, body: { actividad_id: actividad } });
                    const [a, b] = await Promise.all([pedir(), pedir()]);
                    assert.deepEqual([a.status, b.status].sort(), [201, 400], JSON.stringify([a.data, b.data]));
                    const n = (await db.query('SELECT COUNT(*)::int AS n FROM inscripciones_extra WHERE actividad_id = $1', [actividad])).rows[0].n;
                    assert.equal(n, 1);
                } finally {
                    await db.query('DELETE FROM inscripciones_extra WHERE actividad_id = $1', [actividad]);
                    await db.query('DELETE FROM actividades_extra WHERE id = $1', [actividad]);
                    await api('DELETE', `/api/auth/users/${cuenta.data.id}`, { token: tokens.admin });
                }
            });
        });

        describe('transporte', () => {
            it('solo el administrador asigna, ve y quita asignaciones', async () => {
                for (const t of [tokens.docente, tokens.padre, tokens.alumno]) {
                    assert.equal((await asignar(F.aTransp, F.ruta, '', t)).status, 403);
                    assert.equal((await api('GET', '/api/servicios/transporte/asignaciones', { token: t })).status, 403);
                    assert.equal((await api('DELETE', '/api/servicios/transporte/asignaciones/1', { token: t })).status, 403);
                }
            });

            it('rechaza los datos inválidos', async () => {
                assert.equal((await asignar(undefined, F.ruta)).status, 400);
                assert.equal((await asignar(F.aTransp, undefined)).status, 400);
                assert.equal((await asignar('abc', F.ruta)).status, 400);
                assert.equal((await asignar(F.aTransp, F.ruta, 'x'.repeat(121))).status, 400, 'punto de encuentro demasiado largo');
                assert.equal((await asignar(987654321, F.ruta)).status, 404, 'alumno inexistente');
                assert.equal((await asignar(F.aTransp, 987654321)).status, 404, 'ruta inexistente');
                const inactivo = await asignar(F.inactivo, F.ruta);
                assert.equal(inactivo.status, 409);
                assert.match(inactivo.data.message, /activo/);
            });

            it('asigna con su punto de encuentro y no admite la misma asignación ni otra ruta', async () => {
                await db.query('UPDATE transporte_rutas SET capacidad_max = $1 WHERE id = $2', [F.ocupadosInicial + 50, F.ruta]);
                const ok = await asignar(F.aTransp, F.ruta, '  Plaza Central  ');
                assert.equal(ok.status, 201, JSON.stringify(ok.data));
                const guardada = (await db.query('SELECT punto_encuentro FROM transporte_asignaciones WHERE id = $1', [ok.data.id])).rows[0];
                assert.equal(guardada.punto_encuentro, 'Plaza Central');

                const igual = await asignar(F.aTransp, F.ruta, '');
                assert.equal(igual.status, 409);
                assert.match(igual.data.message, /ya está asignado a esta ruta/);
                const otra = await asignar(F.aTransp, F.rutaOtra, '');
                assert.equal(otra.status, 409);
                assert.match(otra.data.message, /Quitale esa asignación/);
                const n = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_asignaciones WHERE alumno_id = $1', [F.aTransp])).rows[0].n;
                assert.equal(n, 1);
            });

            it('lista las asignaciones con legajo y recorrido, y se pueden filtrar por ruta', async () => {
                const todas = await api('GET', '/api/servicios/transporte/asignaciones', { token: tokens.admin });
                assert.equal(todas.status, 200);
                const fila = todas.data.find(a => a.alumno_id === F.aTransp);
                assert.equal(fila.legajo, leg('A', F.aTransp));
                assert.equal(fila.apellido, 'Aranda');
                assert.equal(fila.punto_encuentro, 'Plaza Central');
                const deLaRuta = await api('GET', `/api/servicios/transporte/asignaciones?ruta_id=${F.ruta}`, { token: tokens.admin });
                assert.ok(deLaRuta.data.every(a => a.ruta_id === F.ruta) && deLaRuta.data.some(a => a.alumno_id === F.aTransp));
                const deOtra = await api('GET', `/api/servicios/transporte/asignaciones?ruta_id=${F.rutaOtra}`, { token: tokens.admin });
                assert.ok(!deOtra.data.some(a => a.alumno_id === F.aTransp));
                assert.equal((await api('GET', '/api/servicios/transporte/asignaciones?ruta_id=abc', { token: tokens.admin })).status, 400);
            });

            it('respeta la capacidad, contando también a los inscriptos del mes, y quien ya viaja no ocupa lugar nuevo', async () => {
                const ocupados = (await rutaDesdeApi(F.ruta)).ocupados;
                await db.query('UPDATE transporte_rutas SET capacidad_max = $1 WHERE id = $2', [ocupados + 1, F.ruta]);

                const bAsignado = await asignar(F.bTransp, F.ruta, '');
                assert.equal(bAsignado.status, 201, 'queda justo un lugar');
                const completa = await asignar(F.cTransp, F.ruta, '');
                assert.equal(completa.status, 409);
                assert.match(completa.data.message, /completa/);
                assert.equal((await db.query('SELECT 1 FROM transporte_asignaciones WHERE alumno_id = $1', [F.cTransp])).rowCount, 0);

                // un alumno inscripto este mes en el servicio del recorrido ya cuenta como ocupante: asignarlo no pide un lugar más
                await db.query('INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, $3, $4)', [F.viajero, F.servicioRuta, MES, ANIO]);
                const conInscripcion = await asignar(F.viajero, F.ruta, '');
                assert.equal(conInscripcion.status, 201, JSON.stringify(conInscripcion.data));

                const ruta = await rutaDesdeApi(F.ruta);
                assert.equal(ruta.ocupados, ocupados + 2, 'asignados e inscriptos del mes, sin repetir');
                assert.equal(ruta.capacidad, ocupados + 1);
            });

            it('si dos asignaciones piden el último lugar a la vez, solo una lo consigue', async () => {
                const ocupados = (await rutaDesdeApi(F.ruta)).ocupados;
                await db.query('UPDATE transporte_rutas SET capacidad_max = $1 WHERE id = $2', [ocupados + 1, F.ruta]);
                const x = await alumno('Ibarra');
                const y = await alumno('Juarez');
                const [a, b] = await Promise.all([asignar(x, F.ruta, ''), asignar(y, F.ruta, '')]);
                assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.data, b.data]));
                const n = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_asignaciones WHERE alumno_id = ANY($1)', [[x, y]])).rows[0].n;
                assert.equal(n, 1, 'no se supera la capacidad');
            });

            it('quitar una asignación libera el lugar y permite asignar otro recorrido', async () => {
                await db.query('UPDATE transporte_rutas SET capacidad_max = $1 WHERE id = $2', [F.ocupadosInicial + 50, F.ruta]);
                const asignacion = (await api('GET', '/api/servicios/transporte/asignaciones', { token: tokens.admin })).data.find(a => a.alumno_id === F.aTransp);
                assert.equal((await api('DELETE', `/api/servicios/transporte/asignaciones/${asignacion.id}`, { token: tokens.admin })).status, 200);
                assert.equal((await api('DELETE', `/api/servicios/transporte/asignaciones/${asignacion.id}`, { token: tokens.admin })).status, 404);
                assert.equal((await api('DELETE', '/api/servicios/transporte/asignaciones/abc', { token: tokens.admin })).status, 400);
                const otra = await asignar(F.aTransp, F.rutaOtra, 'Esquina');
                assert.equal(otra.status, 201, JSON.stringify(otra.data));
            });

            it('no elimina un recorrido con alumnos asignados o con servicio en el catálogo', async () => {
                const conAsignados = await api('DELETE', `/api/servicios/transporte/rutas/${F.rutaOtra}`, { token: tokens.admin });
                assert.equal(conAsignados.status, 409);
                assert.match(conAsignados.data.message, /asignad/);
                const tambienAsignados = await api('DELETE', `/api/servicios/transporte/rutas/${F.ruta}`, { token: tokens.admin });
                assert.equal(tambienAsignados.status, 409);
                assert.equal((await api('DELETE', '/api/servicios/transporte/rutas/987654321', { token: tokens.admin })).status, 404);
                assert.equal((await api('DELETE', '/api/servicios/transporte/rutas/abc', { token: tokens.admin })).status, 400);
                for (const id of [F.ruta, F.rutaOtra]) {
                    assert.equal((await db.query('SELECT 1 FROM transporte_rutas WHERE id = $1', [id])).rowCount, 1, 'las rutas siguen existiendo');
                }
            });

            it('elimina un recorrido sin alumnos ni servicios', async () => {
                const temporal = (await db.query("INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Prueba', 5) RETURNING id", [`D-Temp-${tag}`])).rows[0].id;
                try {
                    const r = await api('DELETE', `/api/servicios/transporte/rutas/${temporal}`, { token: tokens.admin });
                    assert.equal(r.status, 200, JSON.stringify(r.data));
                    assert.equal((await db.query('SELECT 1 FROM transporte_rutas WHERE id = $1', [temporal])).rowCount, 0);
                } finally {
                    await db.query('DELETE FROM transporte_rutas WHERE id = $1', [temporal]);
                }
            });

            it('tampoco elimina un recorrido que tiene su servicio de transporte, aunque no tenga alumnos asignados', async () => {
                const temporal = (await db.query("INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Prueba', 5) RETURNING id", [`D-Serv-${tag}`])).rows[0].id;
                const servicio = (await db.query("INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Transporte', $1, 1000, $2) RETURNING id", [`D-Serv-${tag}`, temporal])).rows[0].id;
                try {
                    const r = await api('DELETE', `/api/servicios/transporte/rutas/${temporal}`, { token: tokens.admin });
                    assert.equal(r.status, 409);
                    assert.match(r.data.message, /catálogo/);
                } finally {
                    await db.query('DELETE FROM servicios WHERE id = $1', [servicio]);
                    await db.query('DELETE FROM transporte_rutas WHERE id = $1', [temporal]);
                }
            });
        });

        describe('comedor', () => {
            const registros = (alumnoId) => db.query('SELECT consumio_menu, observaciones FROM comedor_asistencias WHERE alumno_id = $1 AND fecha = CURRENT_DATE', [alumnoId]);

            it('registra un día por alumno: volver a registrarlo corrige el registro en lugar de duplicarlo', async () => {
                const primero = await comedor({ alumno_id: F.comedor, consumio_menu: 1, observaciones: ' Sin sal ' });
                assert.equal(primero.status, 201, JSON.stringify(primero.data));
                const segundo = await comedor({ alumno_id: F.comedor, consumio_menu: 0, observaciones: 'No quiso' });
                assert.equal(segundo.status, 200);
                assert.equal(segundo.data.id, primero.data.id);
                assert.equal(segundo.data.actualizado, true);
                const filas = (await registros(F.comedor)).rows;
                assert.deepEqual(filas, [{ consumio_menu: false, observaciones: 'No quiso' }]);
            });

            it('sin datos de consumo se toma como que sí consumió, y el administrador también puede registrar', async () => {
                const otro = await alumno('Hidalgo');
                const r = await comedor({ alumno_id: otro }, tokens.admin);
                assert.equal(r.status, 201);
                assert.deepEqual((await registros(otro)).rows, [{ consumio_menu: true, observaciones: null }]);
            });

            it('valida el alumno, el consumo y las observaciones', async () => {
                assert.equal((await comedor({})).status, 400);
                assert.equal((await comedor({ alumno_id: 'abc' })).status, 400);
                assert.equal((await comedor({ alumno_id: 987654321 })).status, 404);
                assert.equal((await comedor({ alumno_id: F.comedor, consumio_menu: 'quizás' })).status, 400);
                assert.equal((await comedor({ alumno_id: F.comedor, observaciones: 'x'.repeat(301) })).status, 400);
                assert.equal((await comedor({ alumno_id: F.comedor }, null)).status, 403, 'sin sesión');
                assert.equal((await comedor({ alumno_id: F.comedor }, tokens.padre)).status, 403);
            });
        });

        describe('migración: duplicados anteriores', () => {
            it('elimina los duplicados exactos conservando el que corresponde, y no corta el arranque si no puede', async () => {
                const schema = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');
                const cuenta = (await api('POST', '/api/auth/users', { token: tokens.admin, body: { nombre: 'Cuenta Migra', username: `d-mig-${tag}`, password: PASS, rol: 'alumno' } })).data.id;
                const actividad = (await db.query("INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, 'Cultura', 'x', 10) RETURNING id", [`D-${tag}-Mig`])).rows[0].id;
                const materia = (await db.query('INSERT INTO materias (nombre, curso_id) VALUES ($1, $2) RETURNING id', [`Migra ${tag}`, F.curso])).rows[0].id;
                const alumnoMig = await alumno('Migrado');
                const client = await db.getClient();
                try {
                    // Todo dentro de una transacción que se deshace: la base de pruebas queda como estaba.
                    await client.query('BEGIN');
                    for (const indice of ['inscripciones_extra_alumno_actividad_uq', 'transporte_asignaciones_alumno_uq', 'comedor_asistencias_alumno_fecha_uq',
                        'calificaciones_alumno_materia_trimestre_uq', 'cursos_nivel_division_uq']) {
                        await client.query(`DROP INDEX ${indice}`);
                    }
                    const insertar = async (sql, params) => (await client.query(`${sql} RETURNING id`, params)).rows[0].id;
                    const ie1 = await insertar('INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2)', [cuenta, actividad]);
                    const ie2 = await insertar('INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2)', [cuenta, actividad]);
                    const ta1 = await insertar('INSERT INTO transporte_asignaciones (alumno_id, ruta_id) VALUES ($1, $2)', [alumnoMig, F.ruta]);
                    const ta2 = await insertar('INSERT INTO transporte_asignaciones (alumno_id, ruta_id) VALUES ($1, $2)', [alumnoMig, F.rutaOtra]);
                    const ca1 = await insertar('INSERT INTO comedor_asistencias (alumno_id, fecha, consumio_menu) VALUES ($1, $2, true)', [alumnoMig, '2031-04-04']);
                    const ca2 = await insertar('INSERT INTO comedor_asistencias (alumno_id, fecha, consumio_menu) VALUES ($1, $2, false)', [alumnoMig, '2031-04-04']);
                    const no1 = await insertar('INSERT INTO calificaciones (alumno_id, materia_id, nota, trimestre) VALUES ($1, $2, 4, 1)', [alumnoMig, materia]);
                    const no2 = await insertar('INSERT INTO calificaciones (alumno_id, materia_id, nota, trimestre) VALUES ($1, $2, 9, 1)', [alumnoMig, materia]);
                    const cu1 = await insertar('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 5)', [apoyo.nivel, `MIG-${tag}`]);
                    const cu2 = await insertar('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 5)', [apoyo.nivel, `mig-${tag}`]);

                    await client.query(schema);

                    const quedan = async (tabla, ids) => (await client.query(`SELECT id FROM ${tabla} WHERE id = ANY($1) ORDER BY id`, [ids])).rows.map(r => r.id);
                    assert.deepEqual(await quedan('inscripciones_extra', [ie1, ie2]), [ie1], 'en las actividades se conserva la inscripción original');
                    assert.deepEqual(await quedan('transporte_asignaciones', [ta1, ta2]), [ta2], 'en el transporte, la asignación más reciente');
                    assert.deepEqual(await quedan('comedor_asistencias', [ca1, ca2]), [ca2], 'en el comedor, el registro más reciente');
                    assert.deepEqual(await quedan('calificaciones', [no1, no2]), [no2], 'en las notas, la última cargada');
                    // Los cursos repetidos no se tocan (hay alumnos y materias que dependen de ellos): el índice no se crea y el script sigue.
                    assert.deepEqual(await quedan('cursos', [cu1, cu2]), [cu1, cu2]);
                    const indices = (await client.query("SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)", [[
                        'inscripciones_extra_alumno_actividad_uq', 'transporte_asignaciones_alumno_uq', 'comedor_asistencias_alumno_fecha_uq', 'calificaciones_alumno_materia_trimestre_uq', 'cursos_nivel_division_uq',
                    ]])).rows.map(r => r.indexname).sort();
                    assert.deepEqual(indices, [
                        'calificaciones_alumno_materia_trimestre_uq', 'comedor_asistencias_alumno_fecha_uq', 'inscripciones_extra_alumno_actividad_uq', 'transporte_asignaciones_alumno_uq',
                    ], 'se recrean los índices posibles y el de cursos queda sin crear');
                } finally {
                    await client.query('ROLLBACK').catch(() => {});
                    client.release();
                    await db.query('DELETE FROM actividades_extra WHERE id = $1', [actividad]).catch(() => {});
                    await db.query('DELETE FROM materias WHERE id = $1', [materia]).catch(() => {});
                    await api('DELETE', `/api/auth/users/${cuenta}`, { token: tokens.admin });
                }
                const sigue = await db.query("SELECT indexname FROM pg_indexes WHERE indexname = 'cursos_nivel_division_uq'");
                assert.equal(sigue.rowCount, 1, 'el rollback deja la base como estaba');
            });
        });
    });
});
