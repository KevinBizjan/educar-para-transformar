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
});
