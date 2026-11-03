// Reportes de pagos de la Dirección (HU11 y HU12): reglas puras y reportes contra un PostgreSQL REAL.
// La parte de la API solo corre si DATABASE_URL apunta a localhost (crea alumnos, cuotas, servicios y facturas de prueba).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { estadoPago, estadoCargo, estadoServicio, leerAnioMes, leerEstadoPago, sumar, describirPeriodo, ESTADOS_PAGO } = require('../src/utils/pagosReportes');
const { hoyEnArgentina } = require('../src/utils/cuotas');
const { pesos } = require('../src/services/facturasPdf');

describe('Reportes de pagos: reglas puras', () => {
    it('el pago es completo solo si lo abonado cubre todo lo adeudado', () => {
        assert.equal(estadoPago({ adeudado: 27000, pagado: 27000 }), 'Completo');
        assert.equal(estadoPago({ adeudado: 27000, pagado: 27000.01 }), 'Completo');
        assert.equal(estadoPago({ adeudado: 27000, pagado: 26999.99 }), 'Incompleto');
        assert.equal(estadoPago({ adeudado: 27000, pagado: 0 }), 'Incompleto', 'quien no pagó nada también está incompleto');
        assert.equal(estadoPago({ adeudado: 0, pagado: 0 }), 'Sin cargos');
        assert.equal(estadoPago({ adeudado: 0.1 + 0.2, pagado: 0.3 }), 'Completo', 'sin errores de coma flotante');
        assert.deepEqual(ESTADOS_PAGO, ['Completo', 'Incompleto']);
    });

    it('cada cuota o servicio muestra si está pagado, parcial, en revisión o pendiente', () => {
        assert.equal(estadoCargo({ monto: 15000, pagado: 15000 }), 'Pagado');
        assert.equal(estadoCargo({ monto: 15000, pagado: 5000 }), 'Parcial');
        assert.equal(estadoCargo({ monto: 15000, pagado: 0 }), 'Pendiente');
        assert.equal(estadoCargo({ monto: 15000, pagado: 0, enRevision: true }), 'En revisión');
        assert.equal(estadoCargo({ monto: 15000, pagado: 5000, enRevision: true }), 'Parcial');
        assert.equal(estadoServicio({ pagado: true, enRevision: true }), 'Pagado', 'lo pagado gana sobre la revisión');
        assert.equal(estadoServicio({ pagado: false, enRevision: true }), 'En revisión');
        assert.equal(estadoServicio({ pagado: false, enRevision: false }), 'Pendiente');
    });

    it('el año escolar es el actual por defecto y el mes es opcional', () => {
        const hoy = new Date(2026, 10, 3);
        assert.deepEqual(leerAnioMes({}, hoy), { anio: 2026, mes: null });
        assert.deepEqual(leerAnioMes({ anio: '2025' }, hoy), { anio: 2025, mes: null });
        assert.deepEqual(leerAnioMes({ anio: '2025', mes: '3' }, hoy), { anio: 2025, mes: 3 });
        assert.deepEqual(leerAnioMes({ anio: '', mes: '' }, hoy), { anio: 2026, mes: null });
        for (const mala of [{ anio: '2019' }, { anio: '2101' }, { anio: 'x' }, { anio: '2026.5' }, { mes: '0' }, { mes: '13' }, { mes: 'abril' }]) {
            assert.ok(leerAnioMes(mala, hoy).error, JSON.stringify(mala));
        }
    });

    it('valida el estado de pago pedido', () => {
        assert.deepEqual(leerEstadoPago(undefined), { estado: null });
        assert.deepEqual(leerEstadoPago(''), { estado: null });
        assert.deepEqual(leerEstadoPago('Completo'), { estado: 'Completo' });
        assert.ok(leerEstadoPago('completo').error, 'distingue mayúsculas');
        assert.ok(leerEstadoPago('Pagado').error);
    });

    it('suma en centavos exactos y describe el período', () => {
        assert.equal(sumar([0.1, 0.2]), 0.3);
        assert.equal(sumar([12345.67, 15000, -0.67]), 27345);
        assert.equal(sumar([]), 0);
        assert.equal(describirPeriodo({ anio: 2026, mes: 3 }), 'marzo de 2026');
        assert.equal(describirPeriodo({ anio: 2026, mes: null }), 'año 2026');
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('Reportes de pagos (HU11 y HU12)', { skip }, () => {
    let server, base, db, tokenAdmin, tutor, tokenTutor;
    const unico = Date.now();
    const crypto = require('node:crypto');
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [], personal: [], actividades: [], servicios: [], rutas: [], facturas: [], padres: [] };
    const F = {};
    const azar = () => crypto.randomBytes(5).toString('hex');

    async function api(method, path, { token, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        const tipo = res.headers.get('content-type') || '';
        let data = null;
        if (tipo.includes('json')) { try { data = await res.json(); } catch { /* sin JSON */ } } else data = await res.text();
        return { status: res.status, data, tipo };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    const reportePagos = (ruta, consulta = '') => api('GET', `/api/reportes/${ruta}?${consulta}`, { token: tokenAdmin });
    const seccion = (r, titulo) => r.data.secciones.find((s) => s.titulo === titulo);
    const dinero = (n) => pesos(n);

    const alumno = async (apellido, cursoId, estado = 'Activo', tutorId = null) => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('Rep', $1, $2, '2015-05-05', $3, $4, $5) RETURNING id`,
            [apellido, `R${azar()}`, cursoId, tutorId, estado])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const cuota = async (nivelId, mes, anio, monto) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nivelId, monto, mes, anio, `${anio}-${String(mes).padStart(2, '0')}-10`])).rows[0].id;
        ids.cuotas.push(id);
        return id;
    };
    const pago = (alumnoId, cuotaId, monto, fecha) => db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago, fecha_pago) VALUES ($1, $2, $3, 'Transferencia', $4)", [alumnoId, cuotaId, monto, fecha]);
    const docente = async (apellido) => {
        const id = (await db.query("INSERT INTO personal (nombre, apellido, dni, tipo, estado) VALUES ('Prof', $1, $2, 'Docente', 'Activo') RETURNING id", [apellido, `D${azar()}`])).rows[0].id;
        ids.personal.push(id);
        return id;
    };
    const servicioDeporte = async (docenteId, nombre, precio, dia, ini, fin) => {
        const id = (await db.query(
            `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, actividad_id, nivel_id, docente_id, dia_semana, hora_inicio, hora_fin) VALUES ('Deporte', $1, $2, 20, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [`${nombre} ${unico}`, precio, F.actividad, F.nivelId, docenteId, dia, ini, fin])).rows[0].id;
        ids.servicios.push(id);
        return id;
    };
    const inscribir = async (alumnoId, servicioId, mes, anio) => (await db.query('INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, $3, $4) RETURNING id', [alumnoId, servicioId, mes, anio])).rows[0].id;
    // Una factura de la familia con los ítems de servicio indicados, en el estado y con la fecha de pago pedidos
    const facturaDe = async (estado, inscripciones, pagadaEn = null) => {
        const total = inscripciones.length * 1000;
        const id = (await db.query('INSERT INTO facturas (tutor_id, referencia, total, estado, pagada_en) VALUES ($1, $2, $3, $4, $5) RETURNING id', [tutor.id, `HU11-${unico}-${azar()}`, total, estado, pagadaEn])).rows[0].id;
        ids.facturas.push(id);
        for (const { alumno_id, inscripcion_id, monto } of inscripciones) {
            await db.query('INSERT INTO factura_items (factura_id, alumno_id, inscripcion_id, descripcion, monto) VALUES ($1, $2, $3, $4, $5)', [id, alumno_id, inscripcion_id, 'Servicio de prueba', monto]);
        }
        return id;
    };

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');

        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Reportes', username: `hu11-${unico}`, password: 'Reportes123!', rol: 'padre' } });
        assert.equal(r.status, 201);
        tutor = { id: r.data.id };
        ids.padres.push(r.data.id);
        tokenTutor = await login(`hu11-${unico}`, 'Reportes123!');

        F.nivelId = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU11 ${unico}`])).rows[0].id;
        F.cursoId = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 30) RETURNING id', [F.nivelId, 'A'])).rows[0].id;
        ids.niveles.push(F.nivelId);
        ids.cursos.push(F.cursoId);

        // Alumnos: A pagó todo, B pagó una parte, C no pagó nada y D (inactivo) no cuenta
        F.A = await alumno('Alfa', F.cursoId, 'Activo', tutor.id);
        F.B = await alumno('Beta', F.cursoId, 'Activo', tutor.id);
        F.C = await alumno('Gamma', F.cursoId, 'Activo', tutor.id);
        F.D = await alumno('Delta', F.cursoId, 'Inactivo', tutor.id);
        F.marzo = await cuota(F.nivelId, 3, 2020, 15000);
        F.abril = await cuota(F.nivelId, 4, 2020, 12000);
        F.futura = await cuota(F.nivelId, 12, 2099, 99999); // todavía no emitida: no debe aparecer
        await pago(F.A, F.marzo, 15000, '2020-03-15T15:00:00Z');
        await pago(F.A, F.abril, 12000, '2020-04-10T15:00:00Z');
        await pago(F.B, F.marzo, 15000, '2020-03-20T15:00:00Z');
        await pago(F.B, F.abril, 5000, '2020-05-02T15:00:00Z');
        await pago(F.D, F.marzo, 777, '2020-03-21T15:00:00Z');

        // Servicios: el comedor del seed (A pagó por una factura, B no) y los grupos de deporte y el transporte de la prueba
        F.comedor = (await db.query("SELECT id, precio_mensual FROM servicios WHERE tipo = 'Comedor' ORDER BY id LIMIT 1")).rows[0];
        F.P = Number(F.comedor.precio_mensual);
        F.inscA = await inscribir(F.A, F.comedor.id, 3, 2020);
        F.inscB = await inscribir(F.B, F.comedor.id, 3, 2020);
        await facturaDe('Pagada', [{ alumno_id: F.A, inscripcion_id: F.inscA, monto: F.P }], '2020-04-20T15:00:00Z');

        F.actividad = (await db.query("INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, 'Deporte', 'x', 30) RETURNING id", [`Deporte HU11 ${unico}`])).rows[0].id;
        ids.actividades.push(F.actividad);
        F.prof1 = await docente(`Rep${unico}A`);
        F.prof2 = await docente(`Rep${unico}B`);
        F.g1 = await servicioDeporte(F.prof1, 'Grupo lunes', 6000, 1, '16:00', '17:00');
        F.g2 = await servicioDeporte(F.prof1, 'Grupo martes', 5000, 2, '16:00', '17:00');
        F.g3 = await servicioDeporte(F.prof2, 'Grupo lunes tarde', 7000, 1, '18:00', '19:00');
        F.insG1A = await inscribir(F.A, F.g1, 3, 2020);
        await inscribir(F.B, F.g1, 3, 2020);
        await inscribir(F.D, F.g1, 3, 2020); // inactivo: no cuenta
        await inscribir(F.C, F.g2, 3, 2020);
        await facturaDe('Pagada', [{ alumno_id: F.A, inscripcion_id: F.insG1A, monto: 6000 }], '2020-04-22T15:00:00Z');

        F.ruta = (await db.query("INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Chofer Prueba', 10) RETURNING id", [`Ruta HU11 ${unico}`])).rows[0].id;
        ids.rutas.push(F.ruta);
        F.transporte = (await db.query("INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Transporte', $1, 9000, $2) RETURNING id", [`Transporte HU11 ${unico}`, F.ruta])).rows[0].id;
        ids.servicios.push(F.transporte);
        F.insTA = await inscribir(F.A, F.transporte, 3, 2020);
        F.insTB = await inscribir(F.B, F.transporte, 3, 2020);
        await inscribir(F.D, F.transporte, 3, 2020);
        await facturaDe('Pagada', [{ alumno_id: F.A, inscripcion_id: F.insTA, monto: 9000 }], '2020-04-25T15:00:00Z');
        // Inscripciones dadas de baja: no se cobran ni cuentan
        await db.query("INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio, estado) VALUES ($1, $2, 3, 2020, 'Baja')", [F.C, F.transporte]);
        await db.query("INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio, estado) VALUES ($1, $2, 3, 2020, 'Baja')", [F.C, F.g1]);
    });

    after(async () => {
        const conAlumnos = ids.alumnos.length > 0;
        if (conAlumnos) await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        if (ids.padres.length) await db.query('DELETE FROM facturas WHERE tutor_id = ANY($1)', [ids.padres]);
        if (conAlumnos) await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [ids.alumnos]);
        if (conAlumnos) await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        if (ids.servicios.length) await db.query('DELETE FROM servicios WHERE id = ANY($1)', [ids.servicios]);
        if (ids.cuotas.length) await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        if (ids.rutas.length) await db.query('DELETE FROM transporte_rutas WHERE id = ANY($1)', [ids.rutas]);
        if (ids.actividades.length) await db.query('DELETE FROM actividades_extra WHERE id = ANY($1)', [ids.actividades]);
        if (ids.personal.length) await db.query('DELETE FROM personal WHERE id = ANY($1)', [ids.personal]);
        if (ids.cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        if (ids.niveles.length) await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        for (const id of ids.padres) await api('DELETE', `/api/auth/users/${id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('el catálogo incluye los cuatro reportes de pagos con sus filtros', async () => {
        const r = await api('GET', '/api/reportes', { token: tokenAdmin });
        const ids = r.data.map((x) => x.id);
        for (const id of ['ingresos', 'pagos-por-alumno', 'pagos-por-deporte', 'pagos-por-recorrido']) assert.ok(ids.includes(id), id);
        assert.equal(r.data.length, 13, 'los 9 listados y los 4 de pagos');
        const alumnos = r.data.find((x) => x.id === 'pagos-por-alumno');
        assert.deepEqual(alumnos.filtros.map((f) => f.tipo), ['periodo_opcional', 'nivel', 'curso', 'alumno', 'estado_pago']);
    });

    it('pagos por alumno: lo adeudado, lo pagado y lo que falta, con estados Completo e Incompleto', async () => {
        const r = await reportePagos('pagos-por-alumno', `anio=2020&nivel_id=${F.nivelId}`);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        const filas = seccion(r, 'Pagos por alumno').filas;
        const por = (apellido) => filas.find((f) => f.alumno.startsWith(apellido));
        assert.deepEqual([por('Alfa').adeudado, por('Alfa').pagado, por('Alfa').pendiente, por('Alfa').estado], [dinero(27000 + F.P + 9000 + 6000), dinero(27000 + F.P + 9000 + 6000), dinero(0), 'Completo']);
        const beta = por('Beta');
        assert.deepEqual([beta.adeudado, beta.pagado, beta.pendiente, beta.estado], [dinero(27000 + F.P + 9000 + 6000), dinero(20000), dinero(7000 + F.P + 9000 + 6000), 'Incompleto']);
        const gamma = por('Gamma');
        assert.deepEqual([gamma.adeudado, gamma.pagado, gamma.estado], [dinero(27000 + 5000), dinero(0), 'Incompleto']);
        assert.equal(filas.find((f) => f.alumno.startsWith('Delta')), undefined, 'el alumno inactivo no figura');
        const total = filas[filas.length - 1];
        assert.equal(total.alumno, 'TOTAL (3 alumnos)');
        assert.equal(total.pagado, dinero(27000 + F.P + 9000 + 6000 + 20000));
        assert.deepEqual([por('Alfa').legajo, por('Alfa').nivel, por('Alfa').curso].map(Boolean), [true, true, true]);
    });

    it('se puede filtrar por estado de pago, por mes y por curso', async () => {
        const completos = await reportePagos('pagos-por-alumno', `anio=2020&nivel_id=${F.nivelId}&estado_pago=Completo`);
        assert.deepEqual(seccion(completos, 'Pagos por alumno').filas.slice(0, -1).map((f) => f.alumno.split(',')[0]), ['Alfa']);
        const incompletos = await reportePagos('pagos-por-alumno', `anio=2020&nivel_id=${F.nivelId}&estado_pago=Incompleto`);
        assert.deepEqual(seccion(incompletos, 'Pagos por alumno').filas.slice(0, -1).map((f) => f.alumno.split(',')[0]).sort(), ['Beta', 'Gamma']);

        // Solo marzo: todos pagaron la cuota de marzo; falta lo de los servicios de B y la cuota de C
        const marzo = await reportePagos('pagos-por-alumno', `anio=2020&mes=3&nivel_id=${F.nivelId}`);
        const por = (apellido) => seccion(marzo, 'Pagos por alumno').filas.find((f) => f.alumno.startsWith(apellido));
        assert.equal(por('Alfa').estado, 'Completo');
        assert.equal(por('Beta').estado, 'Incompleto', 'le falta lo que debe de los servicios de marzo');
        assert.equal(por('Beta').pendiente, dinero(F.P + 9000 + 6000));
        assert.equal(por('Gamma').adeudado, dinero(15000 + 5000), 'solo la cuota de marzo y el deporte');
        const abril = await reportePagos('pagos-por-alumno', `anio=2020&mes=4&nivel_id=${F.nivelId}`);
        assert.equal(seccion(abril, 'Pagos por alumno').filas.find((f) => f.alumno.startsWith('Alfa')).adeudado, dinero(12000));
        assert.equal((await reportePagos('pagos-por-alumno', `anio=2020&curso_id=${F.cursoId}`)).data.secciones[0].filas.length, 4, 'tres alumnos y el total');
        const futuro = await reportePagos('pagos-por-alumno', `anio=2099&nivel_id=${F.nivelId}`);
        assert.equal(seccion(futuro, 'Pagos por alumno').filas.length, 1, 'una cuota que todavía no se emitió no se cobra: solo queda el total');
        const otroAnio = await reportePagos('pagos-por-alumno', `anio=2021&nivel_id=${F.nivelId}`);
        assert.equal(seccion(otroAnio, 'Pagos por alumno').filas.length, 1, 'sin cargos en 2021 solo queda el total');
    });

    it('al elegir un alumno se ve el detalle de cada cuota y servicio con su estado', async () => {
        const r = await reportePagos('pagos-por-alumno', `anio=2020&alumno_id=${F.B}`);
        const detalle = seccion(r, 'Detalle de cuotas y servicios').filas;
        const estados = Object.fromEntries(detalle.map((d) => [`${d.concepto}|${d.periodo}`, d.estado]));
        assert.equal(estados['Cuota|Marzo 2020'], 'Pagado');
        assert.equal(estados['Cuota|Abril 2020'], 'Parcial');
        assert.equal(estados[Object.keys(estados).find((k) => k.startsWith('Comedor'))], 'Pendiente');
        assert.equal(detalle.find((d) => d.periodo === 'Abril 2020').pagado, dinero(5000));
        // Una factura en revisión no es un pago: queda "En revisión" y la deuda sigue en pie
        await facturaDe('En revision', [{ alumno_id: F.B, inscripcion_id: F.inscB, monto: F.P }]);
        const revision = seccion(await reportePagos('pagos-por-alumno', `anio=2020&alumno_id=${F.B}`), 'Detalle de cuotas y servicios').filas;
        assert.equal(revision.find((d) => d.concepto.startsWith('Comedor')).estado, 'En revisión');
        assert.equal(seccion(await reportePagos('pagos-por-alumno', `anio=2020&alumno_id=${F.B}`), 'Pagos por alumno').filas[0].estado, 'Incompleto');
        assert.equal(seccion(await reportePagos('pagos-por-alumno', `anio=2020&nivel_id=${F.nivelId}`), 'Pagos por alumno').filas.length, 4);
        assert.equal(await api('GET', `/api/reportes/pagos-por-alumno?anio=2020&nivel_id=${F.nivelId}`, { token: tokenAdmin }).then((x) => x.data.secciones.length), 1, 'sin alumno elegido no hay detalle');
    });

    it('ingresos: lo cobrado en cada mes por concepto, y lo que falta cobrar', async () => {
        const r = await reportePagos('ingresos', `anio=2020&nivel_id=${F.nivelId}`);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        const meses = seccion(r, 'Ingresos por mes').filas;
        assert.equal(meses.length, 13, 'los doce meses y el total');
        const mes = (nombre) => meses.find((m) => m.mes === nombre);
        assert.deepEqual([mes('Marzo').pagos, mes('Marzo').cuotas, mes('Marzo').total], [3, dinero(30777), dinero(30777)], 'incluye lo que pagó el alumno inactivo: la plata entró igual');
        assert.deepEqual([mes('Abril').cuotas, mes('Abril').deporte, mes('Abril').transporte, mes('Abril').comedor, mes('Abril').total], [dinero(12000), dinero(6000), dinero(9000), dinero(F.P), dinero(12000 + 6000 + 9000 + F.P)]);
        assert.equal(mes('Mayo').cuotas, dinero(5000));
        assert.equal(mes('Enero').total, dinero(0));
        const total = meses[12];
        assert.deepEqual([total.mes, total.cuotas, total.total], ['TOTAL', dinero(47777), dinero(47777 + 6000 + 9000 + F.P)]);
        const resumen = Object.fromEntries(seccion(r, 'Resumen del período').filas.map((f) => [f.clave, f.valor]));
        const adeudado = (27000 + F.P + 9000 + 6000) * 2 + 27000 + 5000;
        const pagado = 27000 + F.P + 9000 + 6000 + 20000;
        assert.equal(resumen['Cobrado en el período (por fecha de pago)'], dinero(47777 + 6000 + 9000 + F.P));
        assert.equal(resumen['Adeudado por cuotas y servicios del período'], dinero(adeudado));
        assert.equal(resumen['Pagado de lo adeudado'], dinero(pagado));
        assert.equal(resumen['Pendiente de cobro'], dinero(adeudado - pagado));
        assert.deepEqual([resumen['Alumnos con pago completo'], resumen['Alumnos con pago incompleto']], ['1', '2']);
    });

    it('ingresos de un solo mes y de otro año', async () => {
        const marzo = await reportePagos('ingresos', `anio=2020&mes=3&nivel_id=${F.nivelId}`);
        const filas = seccion(marzo, 'Ingresos por mes').filas;
        assert.deepEqual(filas.map((f) => f.mes), ['Marzo', 'TOTAL']);
        assert.equal(filas[1].total, dinero(30777));
        const otro = await reportePagos('ingresos', `anio=2021&nivel_id=${F.nivelId}`);
        assert.equal(seccion(otro, 'Ingresos por mes').filas[12].total, dinero(0));
    });

    it('pagos por deporte: por profesor, horario y nivel, con el total por profesor', async () => {
        const r = await reportePagos('pagos-por-deporte', `mes=3&anio=2020&nivel_id=${F.nivelId}`);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        const grupos = seccion(r, 'Pagos por grupo').filas;
        assert.equal(grupos.length, 4, 'tres grupos y el total');
        assert.deepEqual(grupos.slice(0, 3).map((g) => g.horario.split(' ')[0]), ['lunes', 'martes', 'lunes'], 'por profesor y luego por día y hora');
        assert.deepEqual(grupos.slice(0, 3).map((g) => g.profesor.split(',')[0]), [`Rep${unico}A`, `Rep${unico}A`, `Rep${unico}B`]);
        assert.match(grupos[0].horario, /16:00/);
        assert.deepEqual([grupos[0].inscriptos, grupos[0].facturado, grupos[0].pagado, grupos[0].pendiente], [2, dinero(12000), dinero(6000), dinero(6000)]);
        assert.deepEqual([grupos[1].inscriptos, grupos[1].facturado, grupos[1].pagado, grupos[1].pendiente], [1, dinero(5000), dinero(0), dinero(5000)]);
        assert.deepEqual([grupos[2].inscriptos, grupos[2].facturado], [0, dinero(0)], 'un grupo sin inscriptos igual figura');
        assert.deepEqual([grupos[3].inscriptos, grupos[3].facturado, grupos[3].pagado, grupos[3].pendiente], [3, dinero(17000), dinero(6000), dinero(11000)], 'el inactivo no cuenta');
        const profesores = seccion(r, 'Total por profesor').filas;
        assert.deepEqual(profesores.map((p) => [p.grupos, p.inscriptos, p.facturado, p.pagado]), [[2, 3, dinero(17000), dinero(6000)], [1, 0, dinero(0), dinero(0)]]);
        const otroMes = await reportePagos('pagos-por-deporte', `mes=4&anio=2020&nivel_id=${F.nivelId}`);
        assert.equal(seccion(otroMes, 'Pagos por grupo').filas[3].inscriptos, 0, 'las inscripciones son mensuales');
        assert.equal(seccion(await reportePagos('pagos-por-deporte', `mes=3&anio=2020&nivel_id=${F.nivelId}&actividad_id=${F.actividad}`), 'Pagos por grupo').filas.length, 4);
    });

    it('pagos por recorrido: por recorrido y con el detalle de cada alumno', async () => {
        const r = await reportePagos('pagos-por-recorrido', `mes=3&anio=2020&ruta_id=${F.ruta}`);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        const [recorrido, total] = seccion(r, 'Pagos por recorrido').filas;
        assert.deepEqual([recorrido.chofer, recorrido.inscriptos, recorrido.capacidad, recorrido.pagados, recorrido.facturado, recorrido.pagado, recorrido.pendiente], ['Chofer Prueba', 2, 10, 1, dinero(18000), dinero(9000), dinero(9000)]);
        assert.equal(total.recorrido, 'TOTAL');
        const detalle = seccion(r, 'Detalle por alumno').filas;
        assert.deepEqual(detalle.map((d) => [d.alumno.split(',')[0], d.estado]), [['Alfa', 'Pagado'], ['Beta', 'Pendiente']], 'el inactivo no figura');
        await facturaDe('En revision', [{ alumno_id: F.B, inscripcion_id: F.insTB, monto: 9000 }]);
        const revision = seccion(await reportePagos('pagos-por-recorrido', `mes=3&anio=2020&ruta_id=${F.ruta}`), 'Detalle por alumno').filas;
        assert.equal(revision[1].estado, 'En revisión');
    });

    it('lo que las familias hacen desde la app aparece en los reportes con los mismos números', async () => {
        const hoy = hoyEnArgentina().split('-').map(Number);
        const hijo = await alumno('Epsilon', F.cursoId, 'Activo', tutor.id);
        // Inscripciones con el mismo endpoint que usa la app, en el mes actual
        const deporte = await api('POST', '/api/inscripciones', { token: tokenTutor, body: { alumno_id: hijo, servicio_id: F.g3, mes: hoy[1], anio: hoy[0] } });
        assert.equal(deporte.status, 201, JSON.stringify(deporte.data));
        const transporte = await api('POST', '/api/inscripciones', { token: tokenTutor, body: { alumno_id: hijo, servicio_id: F.transporte, mes: hoy[1], anio: hoy[0] } });
        assert.equal(transporte.status, 201, JSON.stringify(transporte.data));

        const d = seccion(await reportePagos('pagos-por-deporte', `mes=${hoy[1]}&anio=${hoy[0]}&nivel_id=${F.nivelId}`), 'Pagos por grupo').filas;
        const g3 = d.find((g) => g.profesor.startsWith(`Rep${unico}B`));
        assert.deepEqual([g3.inscriptos, g3.facturado, g3.pagado, g3.pendiente], [1, dinero(7000), dinero(0), dinero(7000)]);
        const t = seccion(await reportePagos('pagos-por-recorrido', `mes=${hoy[1]}&anio=${hoy[0]}&ruta_id=${F.ruta}`), 'Detalle por alumno').filas;
        assert.deepEqual(t.map((x) => [x.alumno.split(',')[0], x.estado]), [['Epsilon', 'Pendiente']]);

        // La familia paga desde la app: genera la factura con esos ítems y la Dirección la da por pagada
        const pagables = (await api('GET', '/api/cuentas/pagables', { token: tokenTutor })).data.items.filter((i) => i.alumno_id === hijo && i.disponible);
        assert.equal(pagables.length >= 2, true);
        const factura = await api('POST', '/api/cuentas/facturas', { token: tokenTutor, body: { items: pagables.filter((i) => i.tipo === 'servicio').map((i) => ({ tipo: 'servicio', inscripcion_id: i.inscripcion_id })) } });
        assert.equal(factura.status, 201, JSON.stringify(factura.data));
        ids.facturas.push(factura.data.id);
        await db.query("UPDATE facturas SET estado = 'Pagada', pagada_en = NOW() WHERE id = $1", [factura.data.id]);
        const despues = seccion(await reportePagos('pagos-por-deporte', `mes=${hoy[1]}&anio=${hoy[0]}&nivel_id=${F.nivelId}`), 'Pagos por grupo').filas.find((g) => g.profesor.startsWith(`Rep${unico}B`));
        assert.deepEqual([despues.pagado, despues.pendiente], [dinero(7000), dinero(0)], 'lo pagado por la familia se refleja');
        const ingreso = seccion(await reportePagos('ingresos', `anio=${hoy[0]}&mes=${hoy[1]}&nivel_id=${F.nivelId}`), 'Ingresos por mes').filas[0];
        assert.equal(ingreso.deporte, dinero(7000));
        assert.equal(ingreso.transporte, dinero(9000));
    });

    it('valida los filtros y solo el administrador ve los reportes', async () => {
        for (const consulta of ['anio=2019', 'anio=2101', 'anio=x', 'anio=2020&mes=13', 'anio=2020&mes=0', 'anio=2020&estado_pago=Pagado', 'anio=2020&nivel_id=abc', 'anio=2020&nivel_id=-1']) {
            assert.equal((await reportePagos('pagos-por-alumno', consulta)).status, 400, consulta);
        }
        assert.equal((await reportePagos('ingresos', 'anio=2020&mes=13')).status, 400);
        assert.equal((await reportePagos('pagos-por-deporte', 'mes=13&anio=2020')).status, 400);
        assert.equal((await reportePagos('pagos-por-recorrido', 'mes=3&anio=2020&ruta_id=abc')).status, 400);
        for (const ruta of ['ingresos', 'pagos-por-alumno', 'pagos-por-deporte', 'pagos-por-recorrido']) {
            for (const token of [tokenTutor, await login('docente', 'docente123'), await login('alumno', 'alumno123'), null]) {
                assert.equal((await api('GET', `/api/reportes/${ruta}`, { token })).status, 403, ruta);
            }
        }
    });

    it('se descargan en CSV con los mismos datos', async () => {
        for (const [ruta, consulta, texto] of [
            ['pagos-por-alumno', `anio=2020&nivel_id=${F.nivelId}`, 'Incompleto'], ['ingresos', `anio=2020&nivel_id=${F.nivelId}`, 'TOTAL'],
            ['pagos-por-deporte', `mes=3&anio=2020&nivel_id=${F.nivelId}`, 'Profesor a cargo'], ['pagos-por-recorrido', `mes=3&anio=2020&ruta_id=${F.ruta}`, 'Chofer Prueba'],
        ]) {
            const r = await reportePagos(ruta, `${consulta}&formato=csv`);
            assert.equal(r.status, 200, ruta);
            assert.match(r.tipo, /text\/csv/);
            assert.ok(r.data.includes(texto), `${ruta}: ${texto}`);
        }
    });

    it('con cientos de alumnos y todo el año los reportes responden en pocos segundos', async () => {
        const nivel = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU11 carga ${unico}`])).rows[0].id;
        const curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 500) RETURNING id', [nivel, 'A'])).rows[0].id;
        ids.niveles.push(nivel);
        ids.cursos.push(curso);
        await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, estado)
             SELECT 'Carga', 'Alumno' || g, 'C' || substr(md5(random()::text), 1, 10), '2015-01-01', $1, 'Activo' FROM generate_series(1, 400) g`, [curso]);
        const cargados = (await db.query('SELECT id FROM alumnos WHERE curso_id = $1 ORDER BY id', [curso])).rows.map((x) => x.id);
        ids.alumnos.push(...cargados);
        await db.query(
            `INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) SELECT $1, 10000, m, 2021, make_date(2021, m, 10) FROM generate_series(1, 12) m`, [nivel]);
        ids.cuotas.push(...(await db.query('SELECT id FROM cuotas_config WHERE nivel_id = $1', [nivel])).rows.map((x) => x.id));
        // Los alumnos pares pagan los doce meses; los impares, solo los primeros seis
        await db.query(
            `INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago, fecha_pago)
             SELECT a.id, cc.id, cc.monto, 'Transferencia', make_timestamp(2021, cc.mes, 15, 12, 0, 0)
             FROM alumnos a JOIN cuotas_config cc ON cc.nivel_id = $1 WHERE a.curso_id = $2 AND (a.id % 2 = 0 OR cc.mes <= 6)`, [nivel, curso]);

        const medir = async (ruta, consulta) => {
            const inicio = Date.now();
            const r = await reportePagos(ruta, consulta);
            const ms = Date.now() - inicio;
            assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
            return { r, ms };
        };
        const alumnos = await medir('pagos-por-alumno', `anio=2021&nivel_id=${nivel}`);
        const filas = seccion(alumnos.r, 'Pagos por alumno').filas;
        assert.equal(filas.length, 401, '400 alumnos y el total');
        const completos = filas.filter((f) => f.estado === 'Completo').length;
        assert.equal(completos, 200, 'los pares pagaron todo');
        assert.equal(filas.filter((f) => f.estado === 'Incompleto').length, 200);
        assert.equal(filas[400].adeudado, dinero(400 * 120000));
        assert.equal(filas[400].pagado, dinero(200 * 120000 + 200 * 60000));
        const ingresos = await medir('ingresos', `anio=2021&nivel_id=${nivel}`);
        assert.equal(seccion(ingresos.r, 'Ingresos por mes').filas[12].total, dinero(200 * 120000 + 200 * 60000));
        const limite = 3000;
        console.log(`    medición: pagos por alumno ${alumnos.ms} ms, ingresos ${ingresos.ms} ms (400 alumnos, 4.800 cuotas)`);
        assert.ok(alumnos.ms < limite && ingresos.ms < limite, `tardaron ${alumnos.ms} y ${ingresos.ms} ms (límite ${limite})`);
    });
});
