// Historial, PDF y revisión de facturas por la Dirección (HU9): reglas puras, PDF y API contra un PostgreSQL REAL.
// Storage se reemplaza por uno falso en memoria. La parte de la API solo corre si DATABASE_URL apunta a localhost.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const jwt = require('jsonwebtoken');
const { ESTADOS, validarRevision, esFecha, validarRango, resumenFacturas, fechaLocalSql, MAX_MOTIVO } = require('../src/utils/facturas');
const { hoyEnArgentina } = require('../src/utils/cuotas');
const { dibujarFactura, dibujarHistorial, pesos } = require('../src/services/facturasPdf');
const { AlmacenError, usarAlmacen } = require('../src/services/almacenamiento');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const aBuffer = (dibujar) => new Promise((resolve, reject) => {
    const salida = new PassThrough();
    const trozos = [];
    salida.on('data', (t) => trozos.push(t));
    salida.on('end', () => resolve(Buffer.concat(trozos)));
    salida.on('error', reject);
    dibujar(salida);
});

describe('Revisión: reglas puras', () => {
    it('solo se puede pasar a Pagada o Rechazada, y desde los estados que corresponden', () => {
        assert.equal(validarRevision({ estado: 'Pagada' }, 'En revision').estado, 'Pagada');
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: 'Falta el comprobante' }, 'En revision').estado, 'Rechazada');
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: 'Anulada' }, 'Pendiente').estado, 'Rechazada', 'una factura sin comprobantes se puede anular');
        assert.equal(validarRevision({ estado: 'Pagada' }, 'Pendiente').codigo, 409, 'sin comprobantes no se da por pagada');
        for (const final of ['Pagada', 'Rechazada']) {
            assert.equal(validarRevision({ estado: 'Pagada' }, final).codigo, 409, `desde ${final}`);
            assert.equal(validarRevision({ estado: 'Rechazada', motivo: 'x' }, final).codigo, 409, `desde ${final}`);
        }
        for (const mal of [{ estado: 'Pendiente' }, { estado: 'En revision' }, { estado: 'Otra' }, {}, undefined, null]) {
            assert.equal(validarRevision(mal, 'En revision').codigo, 400, JSON.stringify(mal));
        }
    });

    it('rechazar exige un motivo acotado, y pagar lo ignora', () => {
        assert.equal(validarRevision({ estado: 'Rechazada' }, 'En revision').codigo, 400);
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: '   ' }, 'En revision').codigo, 400);
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: 5 }, 'En revision').codigo, 400);
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: 'x'.repeat(MAX_MOTIVO + 1) }, 'En revision').codigo, 400);
        assert.equal(validarRevision({ estado: 'Rechazada', motivo: '  Monto incorrecto  ' }, 'En revision').motivo, 'Monto incorrecto');
        assert.equal(validarRevision({ estado: 'Pagada', motivo: 'ignorado' }, 'En revision').motivo, null);
    });

    it('reconoce solo fechas que existen y valida el orden del rango', () => {
        assert.equal(esFecha('2026-02-28'), true);
        assert.equal(esFecha('2028-02-29'), true, 'año bisiesto');
        for (const mala of ['2026-02-31', '2026-13-01', '26-01-01', '2026-1-1', '', null, undefined, 20260101]) assert.equal(esFecha(mala), false, String(mala));
        assert.deepEqual(validarRango({}), { desde: null, hasta: null });
        assert.deepEqual(validarRango({ desde: '2026-01-01' }), { desde: '2026-01-01', hasta: null });
        assert.deepEqual(validarRango({ desde: '2026-01-01', hasta: '2026-01-01' }), { desde: '2026-01-01', hasta: '2026-01-01' });
        assert.match(validarRango({ desde: '2026-02-01', hasta: '2026-01-01' }).error, /posterior/);
        assert.match(validarRango({ desde: '2026-02-31' }).error, /"desde"/);
        assert.match(validarRango({ hasta: 'mañana' }).error, /"hasta"/);
    });

    it('el resumen suma en centavos exactos por estado', () => {
        const r = resumenFacturas([
            { estado: 'Pagada', total: 0.1 }, { estado: 'Pagada', total: 0.2 }, { estado: 'En revision', total: 12345.67 },
            { estado: 'Pendiente', total: 1.15 }, { estado: 'Rechazada', total: 8.2 },
        ]);
        assert.deepEqual(r, { cantidad: 5, total_facturado: 12355.32, total_pagado: 0.3, total_pendiente: 12346.82, total_rechazado: 8.2 });
        assert.equal(resumenFacturas([]).total_facturado, 0);
        assert.equal(ESTADOS.length, 4);
    });

    it('el filtro por fecha se calcula en hora de Argentina', () => {
        assert.match(fechaLocalSql('f.emitida_en'), /AT TIME ZONE 'UTC'\) AT TIME ZONE 'America\/Argentina\/Buenos_Aires'\)::date/);
    });
});

describe('Revisión: PDF', () => {
    const factura = {
        referencia: 'EPT-20261103-ABC234', estado: 'Pagada', total: 27345.67, emitida_en: '2026-11-03T15:00:00Z', pagada_en: '2026-11-04T12:30:00Z', padre: 'Familia Paz',
        items: [{ descripcion: 'Cuota de Marzo 2026 - Paz, Ana', monto: 15000 }, { descripcion: 'Comedor mensual (Marzo 2026) - Paz, Ana', monto: 12345.67 }],
    };

    it('formatea los pesos con punto para los miles y coma para los centavos', () => {
        assert.equal(pesos(1234567.5), '$1.234.567,50');
        assert.equal(pesos(0), '$0,00');
        assert.equal(pesos(null), '$0,00');
        assert.equal(pesos(-3500), '-$3.500,00');
    });

    it('genera el comprobante de una factura como un PDF válido', async () => {
        const pdf = await aBuffer((s) => dibujarFactura(factura, s));
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.ok(pdf.subarray(-1024).includes(Buffer.from('%%EOF')), 'tiene el final del PDF');
        assert.ok(pdf.length > 1500);
        const rechazada = await aBuffer((s) => dibujarFactura({ ...factura, estado: 'Rechazada', pagada_en: null, motivo_rechazo: 'Falta el comprobante' }, s));
        assert.equal(rechazada.subarray(0, 5).toString(), '%PDF-');
    });

    it('genera el historial aunque esté vacío o tenga muchísimas facturas (varias páginas)', async () => {
        const vacio = await aBuffer((s) => dibujarHistorial({ padre: 'Familia Paz', desde: '2026-01-01', hasta: null, facturas: [], resumen: resumenFacturas([]) }, s));
        assert.equal(vacio.subarray(0, 5).toString(), '%PDF-');
        const muchas = Array.from({ length: 60 }, (_, i) => ({ ...factura, referencia: `EPT-20261103-${String(i).padStart(6, 'A')}`, items: factura.items }));
        const largo = await aBuffer((s) => dibujarHistorial({
            padre: 'Familia Paz', desde: null, hasta: null, facturas: muchas, resumen: resumenFacturas(muchas),
            otrosPagos: [{ fecha_pago: '2026-03-01T10:00:00Z', alumno: 'Paz, Ana', monto: 500, metodo_pago: 'Efectivo', cuota_mes: 3, cuota_anio: 2026 }],
        }, s));
        assert.equal(largo.subarray(0, 5).toString(), '%PDF-');
        assert.ok(largo.length > vacio.length * 3, 'el historial largo ocupa más páginas');
        const paginas = (largo.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
        assert.ok(paginas >= 3, `se repartió en ${paginas} páginas`);
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API de historial y revisión (HU9)', { skip }, () => {
    let server, base, db, tokenAdmin, tutor, token, otroToken;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [] };
    const F = {};
    let almacen;

    const crearFalso = () => {
        const falso = {
            archivos: new Map(),
            async subir(ruta, buffer, tipo) { falso.archivos.set(ruta, { buffer, tipo }); },
            async urlFirmada(ruta, segundos) {
                if (!falso.archivos.has(ruta)) throw new AlmacenError('no existe');
                return `https://storage.invalido/${ruta}?token=t&expira=${segundos}`;
            },
            async borrar(ruta) { falso.archivos.delete(ruta); },
        };
        return falso;
    };
    async function api(method, path, { token: t, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        const tipo = res.headers.get('content-type') || '';
        if (tipo.includes('json')) { try { data = await res.json(); } catch { /* sin JSON */ } } else data = Buffer.from(await res.arrayBuffer());
        return { status: res.status, data, tipo };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    let seq = 0;
    const dni = () => String(Date.now()).slice(-7) + String(++seq).padStart(2, '0');

    // Arma una factura de la familia con una cuota y el servicio, le adjunta un comprobante (queda "En revisión") y la devuelve
    const facturaEnRevision = async () => {
        const items = [{ tipo: 'cuota', alumno_id: F.hijo, cuota_id: F.marzo }, { tipo: 'cuota', alumno_id: F.hijo, cuota_id: F.abril }, { tipo: 'servicio', inscripcion_id: F.inscripcion }];
        const creada = await api('POST', '/api/cuentas/facturas', { token, body: { items } });
        assert.equal(creada.status, 201, JSON.stringify(creada.data));
        const subido = await api('POST', `/api/cuentas/facturas/${creada.data.id}/comprobantes`, { token, body: { nombre: 'transferencia.png', tipo_mime: 'image/png', contenido: PNG.toString('base64') } });
        assert.equal(subido.status, 201, JSON.stringify(subido.data));
        return creada.data;
    };
    const estadoDe = async (id) => (await db.query('SELECT estado FROM facturas WHERE id = $1', [id])).rows[0].estado;
    const revisar = (id, cuerpo, t = tokenAdmin) => api('PATCH', `/api/facturas/${id}/estado`, { token: t, body: cuerpo });

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');
        otroToken = await login('padre', 'padre123');
        const username = `hu9-${Date.now()}`;
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Revision', username, password: 'Revision123!', rol: 'padre' } });
        assert.equal(r.status, 201);
        tutor = { id: r.data.id };
        token = await login(username, 'Revision123!');

        const nivelId = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU9 ${Date.now()}`])).rows[0].id;
        const cursoId = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [nivelId, 'A'])).rows[0].id;
        ids.niveles.push(nivelId);
        ids.cursos.push(cursoId);
        F.hijo = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('Rev', 'Alfa', $1, '2015-05-05', $2, $3, 'Activo') RETURNING id`, [dni(), cursoId, tutor.id])).rows[0].id;
        ids.alumnos.push(F.hijo);
        for (const [mes, monto, clave] of [[3, 15000, 'marzo'], [4, 12345.67, 'abril']]) {
            F[clave] = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, 2019, $4) RETURNING id', [nivelId, monto, mes, `2019-0${mes}-10`])).rows[0].id;
            ids.cuotas.push(F[clave]);
        }
        F.servicio = (await db.query("SELECT id, precio_mensual FROM servicios WHERE tipo = 'Comedor' ORDER BY id LIMIT 1")).rows[0];
        F.inscripcion = (await db.query('INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, 3, 2020) RETURNING id', [F.hijo, F.servicio.id])).rows[0].id;
        F.total = 15000 + 12345.67 + Number(F.servicio.precio_mensual);
    });

    // El mismo Storage falso en todas las pruebas: un comprobante subido en una se ve en las siguientes
    beforeEach(() => { almacen = almacen || crearFalso(); usarAlmacen(almacen); });

    after(async () => {
        usarAlmacen(undefined);
        await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM facturas WHERE tutor_id = $1', [tutor.id]);
        await db.query('DELETE FROM saldos_alumnos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        if (tutor) await api('DELETE', `/api/auth/users/${tutor.id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('la Dirección ve las facturas con las que esperan revisión primero, y puede filtrarlas', async () => {
        const enRevision = await facturaEnRevision();
        const r = await api('GET', '/api/facturas', { token: tokenAdmin });
        assert.equal(r.status, 200);
        const mia = r.data.facturas.find((f) => f.id === enRevision.id);
        assert.deepEqual([mia.padre, mia.estado, mia.cantidad_items, mia.cantidad_comprobantes, mia.total], ['Familia Revision', 'En revision', 3, 1, F.total]);
        const primeraNoRevision = r.data.facturas.findIndex((f) => f.estado !== 'En revision');
        assert.ok(primeraNoRevision === -1 || r.data.facturas.slice(primeraNoRevision).every((f) => f.estado !== 'En revision'), 'las que esperan revisión van primero');
        const filtradas = await api('GET', '/api/facturas?estado=En revision', { token: tokenAdmin });
        assert.ok(filtradas.data.facturas.every((f) => f.estado === 'En revision') && filtradas.data.facturas.some((f) => f.id === enRevision.id));
        const hoy = hoyEnArgentina();
        assert.ok((await api('GET', `/api/facturas?desde=${hoy}&hasta=${hoy}`, { token: tokenAdmin })).data.facturas.some((f) => f.id === enRevision.id));
        assert.equal((await api('GET', '/api/facturas?hasta=2019-12-31', { token: tokenAdmin })).data.facturas.some((f) => f.id === enRevision.id), false);
        assert.equal((await api('GET', '/api/facturas?estado=Otra', { token: tokenAdmin })).status, 400);
        assert.equal((await api('GET', '/api/facturas?desde=2026-02-31', { token: tokenAdmin })).status, 400);
        F.revision = enRevision;
    });

    it('el detalle trae los ítems y los comprobantes (sin la ruta interna), y se puede ver cada archivo', async () => {
        const r = await api('GET', `/api/facturas/${F.revision.id}`, { token: tokenAdmin });
        assert.equal(r.status, 200);
        assert.equal(r.data.items.length, 3);
        assert.equal(r.data.comprobantes.length, 1);
        assert.ok(!('ruta_storage' in r.data.comprobantes[0]), 'no se filtra la ruta de Storage');
        assert.equal(r.data.padre, 'Familia Revision');
        const url = await api('GET', `/api/facturas/comprobantes/${r.data.comprobantes[0].id}/url`, { token: tokenAdmin });
        assert.equal(url.status, 200);
        assert.match(url.data.url, /^https:\/\/storage\.invalido\//);
        usarAlmacen(null);
        assert.equal((await api('GET', `/api/facturas/comprobantes/${r.data.comprobantes[0].id}/url`, { token: tokenAdmin })).status, 503);
        usarAlmacen(almacen);
        assert.equal((await api('GET', '/api/facturas/999999999', { token: tokenAdmin })).status, 404);
        assert.equal((await api('GET', '/api/facturas/abc', { token: tokenAdmin })).status, 400);
        assert.equal((await api('GET', '/api/facturas/comprobantes/999999999/url', { token: tokenAdmin })).status, 404);
    });

    it('solo el administrador revisa facturas', async () => {
        for (const t of [token, otroToken, await login('docente', 'docente123'), await login('alumno', 'alumno123'), null]) {
            assert.equal((await api('GET', '/api/facturas', { token: t })).status, 403);
            assert.equal((await api('GET', `/api/facturas/${F.revision.id}`, { token: t })).status, 403);
            assert.equal((await revisar(F.revision.id, { estado: 'Pagada' }, t)).status, 403);
        }
        assert.equal(await estadoDe(F.revision.id), 'En revision');
    });

    it('rechazar pide un motivo, la familia lo ve y los ítems quedan libres para facturarse de nuevo', async () => {
        assert.equal((await revisar(F.revision.id, { estado: 'Rechazada' })).status, 400);
        assert.equal((await revisar(F.revision.id, { estado: 'Otra' })).status, 400);
        assert.equal(await estadoDe(F.revision.id), 'En revision');
        const r = await revisar(F.revision.id, { estado: 'Rechazada', motivo: 'El monto transferido no coincide' });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.factura.estado, 'Rechazada');
        assert.equal(r.data.factura.pagada_en, null);
        const propia = await api('GET', `/api/cuentas/facturas/${F.revision.id}`, { token });
        assert.deepEqual([propia.data.estado, propia.data.motivo_rechazo], ['Rechazada', 'El monto transferido no coincide']);
        const { items } = (await api('GET', '/api/cuentas/pagables', { token })).data;
        assert.ok(items.filter((i) => i.alumno_id === F.hijo).every((i) => i.disponible), 'los ítems vuelven a poder elegirse');
        assert.equal((await revisar(F.revision.id, { estado: 'Pagada' })).status, 409, 'una factura rechazada es final');
        const quien = await api('GET', `/api/facturas/${F.revision.id}`, { token: tokenAdmin });
        assert.equal(quien.data.revisada_por, 'Administrador');
    });

    it('una factura sin comprobantes no se da por pagada, pero sí se puede anular', async () => {
        const items = [{ tipo: 'cuota', alumno_id: F.hijo, cuota_id: F.marzo }];
        const f = (await api('POST', '/api/cuentas/facturas', { token, body: { items } })).data;
        assert.equal((await revisar(f.id, { estado: 'Pagada' })).status, 409);
        assert.equal((await revisar(f.id, { estado: 'Rechazada', motivo: 'Anulada a pedido de la familia' })).status, 200);
        assert.equal(await estadoDe(f.id), 'Rechazada');
    });

    it('aprobar registra los pagos de las cuotas, baja el saldo, y las cuotas y el servicio pasan a pagados', async () => {
        const f = await facturaEnRevision();
        const antes = Number((await db.query('SELECT COALESCE((SELECT saldo_pendiente FROM saldos_alumnos WHERE alumno_id = $1), 0) AS s', [F.hijo])).rows[0].s);
        const r = await revisar(f.id, { estado: 'Pagada' });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.factura.estado, 'Pagada');
        assert.ok(r.data.factura.pagada_en);
        const pagos = (await db.query('SELECT cuota_id, monto_pagado, metodo_pago FROM pagos WHERE factura_id = $1 ORDER BY cuota_id', [f.id])).rows;
        assert.deepEqual(pagos.map((p) => [p.cuota_id, Number(p.monto_pagado), p.metodo_pago]), [[F.marzo, 15000, 'Transferencia'], [F.abril, 12345.67, 'Transferencia']], 'solo las cuotas generan pagos, no el servicio');
        const despues = Number((await db.query('SELECT saldo_pendiente AS s FROM saldos_alumnos WHERE alumno_id = $1', [F.hijo])).rows[0].s);
        assert.equal(Math.round((antes - despues) * 100), Math.round((15000 + 12345.67) * 100), 'el saldo baja por el total de las cuotas');
        const pagadas = await api('GET', `/api/cuentas/cuotas?estado=pagadas&alumno_id=${F.hijo}`, { token });
        assert.deepEqual(pagadas.data.cuotas.map((c) => c.mes).sort(), [3, 4]);
        assert.equal(pagadas.data.hay_deuda, false);
        assert.ok(!(await api('GET', '/api/cuentas/pagables', { token })).data.items.some((i) => i.alumno_id === F.hijo), 'ya no queda nada para pagar');
        F.pagada = f;
    });

    it('aprobar dos veces no duplica los pagos', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM pagos WHERE factura_id = $1', [F.pagada.id])).rows[0].n;
        assert.equal((await revisar(F.pagada.id, { estado: 'Pagada' })).status, 409);
        assert.equal((await revisar(F.pagada.id, { estado: 'Rechazada', motivo: 'x' })).status, 409);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pagos WHERE factura_id = $1', [F.pagada.id])).rows[0].n, antes);
        assert.equal(await estadoDe(F.pagada.id), 'Pagada');
    });

    it('dos aprobaciones simultáneas: una prospera y la otra recibe 409, y los pagos quedan una sola vez', async () => {
        // Se libera lo pagado para armar otra factura: se pasa a Rechazada la anterior en la base solo para el armado
        await db.query("UPDATE facturas SET estado = 'Pagada' WHERE id = $1", [F.pagada.id]);
        await db.query('DELETE FROM pagos WHERE factura_id = $1', [F.pagada.id]);
        await db.query("UPDATE facturas SET estado = 'Rechazada', motivo_rechazo = 'reinicio de la prueba' WHERE id = $1", [F.pagada.id]);
        const f = await facturaEnRevision();
        const estados = (await Promise.all(Array.from({ length: 6 }, () => revisar(f.id, { estado: 'Pagada' })))).map((r) => r.status).sort();
        assert.deepEqual(estados, [200, 409, 409, 409, 409, 409]);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pagos WHERE factura_id = $1', [f.id])).rows[0].n, 2);
        F.pagada = f;
    });

    it('el historial filtra por rango de fechas, desglosa por ítem y resume los totales', async () => {
        const hoy = hoyEnArgentina();
        const todo = await api('GET', '/api/cuentas/historial', { token });
        assert.equal(todo.status, 200);
        assert.ok(todo.data.facturas.length >= 3, 'incluye rechazadas y pagadas');
        const pagada = todo.data.facturas.find((f) => f.id === F.pagada.id);
        assert.equal(pagada.items.length, 3, 'desglose por ítem');
        assert.deepEqual(pagada.items.map((i) => i.monto).sort((a, b) => a - b), [12345.67, 15000, Number(F.servicio.precio_mensual)].sort((a, b) => a - b));
        assert.ok(pagada.items.every((i) => i.alumno === 'Alfa, Rev'));
        assert.equal(todo.data.resumen.cantidad, todo.data.facturas.length);
        assert.equal(todo.data.resumen.total_pagado, F.total, 'solo cuenta lo pagado');
        assert.ok(todo.data.resumen.total_rechazado > 0);

        const hoyNomas = await api('GET', `/api/cuentas/historial?desde=${hoy}&hasta=${hoy}`, { token });
        assert.equal(hoyNomas.data.facturas.length, todo.data.facturas.length, 'todas se emitieron hoy');
        assert.equal((await api('GET', '/api/cuentas/historial?hasta=2019-12-31', { token })).data.facturas.length, 0);
        const futuro = await api('GET', '/api/cuentas/historial?desde=2099-01-01', { token });
        assert.deepEqual([futuro.data.facturas.length, futuro.data.resumen.total_facturado], [0, 0]);
        assert.equal((await api('GET', '/api/cuentas/historial?desde=2026-02-31', { token })).status, 400);
        assert.equal((await api('GET', '/api/cuentas/historial?desde=2026-03-01&hasta=2026-01-01', { token })).status, 400);
        assert.equal((await api('GET', '/api/cuentas/historial', { token: null })).status, 403);
    });

    it('el historial incluye los pagos que cargó la institución, pero no los que salieron de aprobar una factura', async () => {
        await db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, NULL, 500.5, 'Efectivo en secretaría')", [F.hijo]);
        const r = await api('GET', '/api/cuentas/historial', { token });
        assert.equal(r.data.otros_pagos.length, 1);
        assert.deepEqual([r.data.otros_pagos[0].monto, r.data.otros_pagos[0].metodo_pago], [500.5, 'Efectivo en secretaría']);
        const ajeno = await api('GET', '/api/cuentas/historial', { token: otroToken });
        assert.ok(ajeno.data.facturas.every((f) => f.id !== F.pagada.id), 'cada familia ve lo suyo');
    });

    it('el PDF se abre con un enlace temporal firmado, sin sesión, y solo para lo propio', async () => {
        const enlace = await api('GET', `/api/cuentas/pdf-enlace?tipo=factura&id=${F.pagada.id}`, { token });
        assert.equal(enlace.status, 200);
        assert.equal(enlace.data.vence_en_segundos, 300);
        const pdf = await api('GET', enlace.data.ruta);
        assert.equal(pdf.status, 200);
        assert.match(pdf.tipo, /application\/pdf/);
        assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');

        const historial = await api('GET', `/api/cuentas/pdf-enlace?tipo=historial&desde=${hoyEnArgentina()}`, { token });
        const pdfHistorial = await api('GET', historial.data.ruta);
        assert.equal(pdfHistorial.status, 200);
        assert.equal(pdfHistorial.data.subarray(0, 5).toString(), '%PDF-');

        assert.equal((await api('GET', `/api/cuentas/pdf-enlace?tipo=factura&id=${F.pagada.id}`, { token: otroToken })).status, 403, 'factura de otra familia');
        assert.equal((await api('GET', '/api/cuentas/pdf-enlace?tipo=factura&id=999999999', { token })).status, 404);
        assert.equal((await api('GET', '/api/cuentas/pdf-enlace?tipo=factura&id=abc', { token })).status, 400);
        assert.equal((await api('GET', '/api/cuentas/pdf-enlace?tipo=otro', { token })).status, 400);
        assert.equal((await api('GET', '/api/cuentas/pdf-enlace?tipo=historial&desde=2026-02-31', { token })).status, 400);
        assert.equal((await api('GET', `/api/cuentas/pdf-enlace?tipo=factura&id=${F.pagada.id}`, { token: null })).status, 403);
    });

    it('un enlace de PDF falsificado, vencido o que no es de PDF no sirve, y no abre sesión', async () => {
        const enlace = (await api('GET', `/api/cuentas/pdf-enlace?tipo=factura&id=${F.pagada.id}`, { token })).data.ruta;
        const jwtPdf = enlace.split('/').pop();
        assert.equal((await api('GET', `${enlace.slice(0, -4)}xxxx`)).status, 401, 'firma alterada');
        assert.equal((await api('GET', '/api/cuentas/pdf/no-es-un-token')).status, 401);
        const vencido = jwt.sign({ pdf: true, uid: tutor.id, tipo: 'factura', fid: F.pagada.id }, `${process.env.JWT_SECRET}:pdf`, { expiresIn: -10 });
        assert.equal((await api('GET', `/api/cuentas/pdf/${vencido}`)).status, 401);
        assert.equal((await api('GET', `/api/cuentas/pdf/${token}`)).status, 401, 'un token de sesión no abre un PDF');
        const ajeno = jwt.sign({ pdf: true, uid: tutor.id + 999999, tipo: 'factura', fid: F.pagada.id }, `${process.env.JWT_SECRET}:pdf`, { expiresIn: 60 });
        assert.equal((await api('GET', `/api/cuentas/pdf/${ajeno}`)).status, 404, 'la factura tiene que ser del dueño del token');
        const sesion = await api('GET', '/api/cuentas/cuotas', { token: jwtPdf });
        assert.ok([401, 403].includes(sesion.status), `un token de PDF no abre sesión (${sesion.status})`);
    });
});
