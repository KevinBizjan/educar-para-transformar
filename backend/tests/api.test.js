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
});
