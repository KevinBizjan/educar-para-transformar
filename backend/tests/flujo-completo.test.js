// Flujo completo de punta a punta (HU13): una familia se inscribe a servicios, genera sus facturas, sube los
// comprobantes, la Dirección rechaza una y aprueba la otra, la familia corrige y los reportes cierran al centavo.
// Todo pasa por la API real (la misma que usan la web y la app móvil); la base solo se mira para comprobar que
// no se perdió ni se duplicó nada. El Storage es falso: la prueba no escribe en Supabase.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { usarAlmacen, AlmacenError } = require('../src/services/almacenamiento');
const { hoyEnArgentina } = require('../src/utils/cuotas');
const { pesos } = require('../src/services/facturasPdf');

// Los dos bloques comparten el pool de la base: se cierra una sola vez, cuando terminó el último
after(async () => {
    if (/@(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL || '')) await require('../src/config/database').end();
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

// PNG válido mínimo (1x1): pasa la validación por contenido
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Flujo completo: inscripción → factura → pago → reporte (HU13)', { skip }, () => {
    let server, base, db, tokenAdmin, tokenPadre, padre, almacen;
    const unico = Date.now();
    const azar = () => crypto.randomBytes(5).toString('hex');
    const claveFamilia = `Aa1!${crypto.randomBytes(8).toString('hex')}`;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [], personal: [], actividades: [], servicios: [], rutas: [], padres: [] };
    const F = {};
    const [anio, mes] = hoyEnArgentina().split('-').map(Number);

    const crearFalso = () => {
        const falso = {
            archivos: new Map(),
            async subir(ruta, buffer, tipo) { falso.archivos.set(ruta, { buffer, tipo }); },
            async urlFirmada(ruta, segundos) {
                if (!falso.archivos.has(ruta)) throw new AlmacenError('no existe');
                return `https://storage.invalido/${ruta}?expira=${segundos}`;
            },
            async borrar(ruta) { falso.archivos.delete(ruta); },
        };
        return falso;
    };
    async function api(method, path, { token, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        const tipo = res.headers.get('content-type') || '';
        let data = null;
        if (tipo.includes('json')) { try { data = await res.json(); } catch { /* sin JSON */ } } else data = Buffer.from(await res.arrayBuffer()).toString('utf8');
        return { status: res.status, data, tipo };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    const admin = (method, path, body) => api(method, path, { token: tokenAdmin, body });
    const familia = (method, path, body) => api(method, path, { token: tokenPadre, body });
    const reporte = (ruta, consulta) => admin('GET', `/api/reportes/${ruta}?${consulta}`);
    const seccion = (r, titulo) => r.data.secciones.find((s) => s.titulo === titulo);
    const centavos = (n) => Math.round(Number(n) * 100);
    const suma = (numeros) => numeros.reduce((a, n) => a + centavos(n), 0) / 100;
    const factura = async (items) => {
        const r = await familia('POST', '/api/cuentas/facturas', { items });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data;
    };
    const comprobante = async (facturaId, nombre = 'transferencia.png') => {
        const r = await familia('POST', `/api/cuentas/facturas/${facturaId}/comprobantes`, { nombre, tipo_mime: 'image/png', contenido: PNG.toString('base64') });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return r.data;
    };
    const revisar = (id, cuerpo) => admin('PATCH', `/api/facturas/${id}/estado`, cuerpo);
    const estadoDe = async (id) => (await db.query('SELECT estado FROM facturas WHERE id = $1', [id])).rows[0].estado;

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');

        // La Dirección da de alta a la familia (cuenta de padre) y arma dos niveles con su curso y su cuota del mes
        const r = await admin('POST', '/api/auth/users', { nombre: 'Familia Flujo', username: `hu13-${unico}`, password: claveFamilia, rol: 'padre' });
        assert.equal(r.status, 201);
        padre = { id: r.data.id };
        ids.padres.push(padre.id);
        tokenPadre = await login(`hu13-${unico}`, claveFamilia);

        for (const clave of ['n1', 'n2']) {
            const nivel = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU13 ${clave} ${unico}`])).rows[0].id;
            const curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [nivel, 'A'])).rows[0].id;
            ids.niveles.push(nivel);
            ids.cursos.push(curso);
            F[clave] = { nivel, curso };
        }
        // Montos con centavos a propósito: es donde se pierden los datos
        F.n1.cuota = 15000.50;
        F.n2.cuota = 12000.10;
        for (const clave of ['n1', 'n2']) {
            const c = await admin('POST', '/api/financiero/cuotas-config', { nivel_id: F[clave].nivel, monto: F[clave].cuota, mes, anio, vencimiento: `${anio}-${String(mes).padStart(2, '0')}-10` });
            assert.equal(c.status, 201, JSON.stringify(c.data));
            F[clave].cuotaId = c.data.id;
            ids.cuotas.push(c.data.id);
        }
        // Servicios: el comedor del seed, un grupo de deporte (nivel 1) y un recorrido de transporte
        F.comedor = (await db.query("SELECT id, precio_mensual FROM servicios WHERE tipo = 'Comedor' ORDER BY id LIMIT 1")).rows[0];
        F.actividad = (await db.query("INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, 'Deporte', 'x', 30) RETURNING id", [`Deporte HU13 ${unico}`])).rows[0].id;
        ids.actividades.push(F.actividad);
        F.profesor = (await db.query("INSERT INTO personal (nombre, apellido, dni, tipo, estado) VALUES ('Prof', $1, $2, 'Docente', 'Activo') RETURNING id", [`Flujo${unico}`, `D${azar()}`])).rows[0].id;
        ids.personal.push(F.profesor);
        F.deporte = (await db.query(
            `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, actividad_id, nivel_id, docente_id, dia_semana, hora_inicio, hora_fin) VALUES ('Deporte', $1, 7000.35, 20, $2, $3, $4, 2, '16:00', '17:00') RETURNING id`,
            [`Grupo HU13 ${unico}`, F.actividad, F.n1.nivel, F.profesor])).rows[0].id;
        ids.servicios.push(F.deporte);
        F.ruta = (await db.query("INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, 'Chofer Flujo', 10) RETURNING id", [`Ruta HU13 ${unico}`])).rows[0].id;
        ids.rutas.push(F.ruta);
        F.transporte = (await db.query("INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Transporte', $1, 9000.10, $2) RETURNING id", [`Transporte HU13 ${unico}`, F.ruta])).rows[0].id;
        ids.servicios.push(F.transporte);
    });

    // El mismo Storage falso en todas las pruebas: un comprobante subido en una se ve en las siguientes
    beforeEach(() => { almacen = almacen || crearFalso(); usarAlmacen(almacen); });

    after(async () => {
        usarAlmacen(undefined);
        if (ids.alumnos.length) {
            await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM saldos_alumnos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        }
        if (ids.padres.length) await db.query('DELETE FROM facturas WHERE tutor_id = ANY($1)', [ids.padres]);
        if (ids.alumnos.length) {
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        }
        if (ids.servicios.length) await db.query('DELETE FROM servicios WHERE id = ANY($1)', [ids.servicios]);
        if (ids.cuotas.length) await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        if (ids.rutas.length) await db.query('DELETE FROM transporte_rutas WHERE id = ANY($1)', [ids.rutas]);
        if (ids.actividades.length) await db.query('DELETE FROM actividades_extra WHERE id = ANY($1)', [ids.actividades]);
        if (ids.personal.length) await db.query('DELETE FROM personal WHERE id = ANY($1)', [ids.personal]);
        if (ids.cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        if (ids.niveles.length) await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        for (const id of ids.padres) await api('DELETE', `/api/auth/users/${id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
    });

    it('1. la Dirección inscribe a los hijos y la familia los ve en la app', async () => {
        for (const [clave, apellido] of [['n1', 'Alfa'], ['n2', 'Beta']]) {
            const r = await admin('POST', '/api/academico/alumnos', {
                nombre: 'Flujo', apellido, dni: String(Math.floor(10000000 + Math.random() * 89999999)) + String(Math.floor(Math.random() * 10)),
                fecha_nacimiento: '2015-05-05', curso_id: F[clave].curso, tutor_id: padre.id, domicilio: 'Calle 1', telefono: '3624000000', email: `flujo-${azar()}@example.com`,
            });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            F[clave].alumno = r.data.id;
            ids.alumnos.push(r.data.id);
        }
        const hijos = await familia('GET', '/api/academico/mis-hijos');
        assert.equal(hijos.status, 200);
        assert.deepEqual(hijos.data.map((h) => h.apellido).sort(), ['Alfa', 'Beta']);
    });

    it('2. la familia se inscribe a los servicios del mes desde la app', async () => {
        const inscribir = async (alumno, servicio) => {
            const r = await familia('POST', '/api/inscripciones', { alumno_id: alumno, servicio_id: servicio, mes, anio });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.id;
        };
        F.n1.insDeporte = await inscribir(F.n1.alumno, F.deporte);
        F.n1.insComedor = await inscribir(F.n1.alumno, F.comedor.id);
        F.n2.insTransporte = await inscribir(F.n2.alumno, F.transporte);
        F.n2.insComedor = await inscribir(F.n2.alumno, F.comedor.id);
        assert.ok(F.n1.insDeporte && F.n1.insComedor && F.n2.insTransporte && F.n2.insComedor);
        F.comida = Number(F.comedor.precio_mensual);
        F.total1 = suma([F.n1.cuota, 7000.35, F.comida]);
        F.total2 = suma([F.n2.cuota, 9000.10, F.comida]);
        F.totalFamilia = suma([F.total1, F.total2]);
    });

    it('3. antes de pagar, lo que ve la familia y lo que ve la Dirección es la misma deuda, al centavo', async () => {
        const { items, total_disponible } = (await familia('GET', '/api/cuentas/pagables')).data;
        assert.equal(items.length, 6, 'dos cuotas y cuatro servicios');
        assert.equal(total_disponible, F.totalFamilia);
        for (const clave of ['n1', 'n2']) {
            const r = await reporte('pagos-por-alumno', `anio=${anio}&mes=${mes}&nivel_id=${F[clave].nivel}`);
            const alumno = seccion(r, 'Pagos por alumno').filas[0];
            assert.deepEqual([alumno.adeudado, alumno.pagado, alumno.estado], [pesos(clave === 'n1' ? F.total1 : F.total2), pesos(0), 'Incompleto']);
        }
        const ingresos = seccion(await reporte('ingresos', `anio=${anio}&mes=${mes}&nivel_id=${F.n1.nivel}`), 'Ingresos por mes').filas.at(-1);
        assert.equal(ingresos.total, pesos(0), 'todavía no entró plata');
    });

    it('4. cada hijo tiene su factura, con el total calculado en el servidor', async () => {
        F.f1 = await factura([
            { tipo: 'cuota', alumno_id: F.n1.alumno, cuota_id: F.n1.cuotaId },
            { tipo: 'servicio', inscripcion_id: F.n1.insDeporte },
            { tipo: 'servicio', inscripcion_id: F.n1.insComedor },
        ]);
        F.f2 = await factura([
            { tipo: 'cuota', alumno_id: F.n2.alumno, cuota_id: F.n2.cuotaId },
            { tipo: 'servicio', inscripcion_id: F.n2.insTransporte },
            { tipo: 'servicio', inscripcion_id: F.n2.insComedor },
        ]);
        assert.equal(F.f1.total, F.total1);
        assert.equal(F.f2.total, F.total2);
        assert.equal(F.f1.estado, 'Pendiente');
        const { items, total_disponible } = (await familia('GET', '/api/cuentas/pagables')).data;
        assert.ok(items.every((i) => !i.disponible), 'ya no se puede facturar dos veces lo mismo');
        assert.equal(total_disponible, 0);
        const repetida = await familia('POST', '/api/cuentas/facturas', { items: [{ tipo: 'cuota', alumno_id: F.n1.alumno, cuota_id: F.n1.cuotaId }] });
        assert.equal(repetida.status, 409);
    });

    it('5. con el comprobante subido las facturas quedan en revisión, y el reporte todavía no las cuenta como pagadas', async () => {
        F.c1 = await comprobante(F.f1.id);
        F.c2 = await comprobante(F.f2.id, 'transferencia-2.png');
        assert.equal(await estadoDe(F.f1.id), 'En revision');
        assert.equal(await estadoDe(F.f2.id), 'En revision');
        assert.equal(almacen.archivos.size >= 2, true, 'los dos archivos están en Storage');
        const r = await reporte('pagos-por-alumno', `anio=${anio}&mes=${mes}&nivel_id=${F.n1.nivel}&alumno_id=${F.n1.alumno}`);
        assert.equal(seccion(r, 'Pagos por alumno').filas[0].pagado, pesos(0));
        const detalle = seccion(r, 'Detalle de cuotas y servicios').filas;
        assert.equal(detalle.length, 3);
        assert.ok(detalle.every((d) => d.estado === 'En revisión'), JSON.stringify(detalle.map((d) => d.estado)));
        const lista = await admin('GET', '/api/facturas?estado=En revision');
        assert.ok([F.f1.id, F.f2.id].every((id) => lista.data.facturas.some((f) => f.id === id)), 'la Dirección ve las dos para revisar');
    });

    it('6. la Dirección aprueba una factura y rechaza la otra con un motivo', async () => {
        const aprobada = await revisar(F.f1.id, { estado: 'Pagada' });
        assert.equal(aprobada.status, 200, JSON.stringify(aprobada.data));
        const rechazada = await revisar(F.f2.id, { estado: 'Rechazada', motivo: 'El monto transferido no coincide con el total' });
        assert.equal(rechazada.status, 200, JSON.stringify(rechazada.data));

        // Los pagos salieron de las cuotas de la factura aprobada, con el monto exacto y atados a esa factura
        const pagos = (await db.query('SELECT alumno_id, cuota_id, monto_pagado FROM pagos WHERE factura_id = $1', [F.f1.id])).rows;
        assert.deepEqual(pagos.map((p) => [p.alumno_id, p.cuota_id, Number(p.monto_pagado)]), [[F.n1.alumno, F.n1.cuotaId, F.n1.cuota]]);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pagos WHERE factura_id = $1', [F.f2.id])).rows[0].n, 0, 'la rechazada no genera pagos');
        const saldo = await admin('GET', `/api/financiero/saldo/${F.n1.alumno}`);
        assert.equal(Number(saldo.data.saldo_pendiente), -F.n1.cuota, 'el saldo baja por la cuota pagada');

        // La familia ve el motivo, y lo rechazado vuelve a estar disponible mientras lo aprobado no
        const propia = await familia('GET', `/api/cuentas/facturas/${F.f2.id}`);
        assert.deepEqual([propia.data.estado, propia.data.motivo_rechazo], ['Rechazada', 'El monto transferido no coincide con el total']);
        const { items } = (await familia('GET', '/api/cuentas/pagables')).data;
        assert.ok(items.filter((i) => i.alumno_id === F.n2.alumno).every((i) => i.disponible));
        assert.equal(items.filter((i) => i.alumno_id === F.n1.alumno).length, 0, 'lo pagado ya no se ofrece');
    });

    it('7. la familia corrige: vuelve a facturar lo rechazado, sube otro comprobante y la Dirección lo aprueba', async () => {
        F.f3 = await factura([
            { tipo: 'cuota', alumno_id: F.n2.alumno, cuota_id: F.n2.cuotaId },
            { tipo: 'servicio', inscripcion_id: F.n2.insTransporte },
            { tipo: 'servicio', inscripcion_id: F.n2.insComedor },
        ]);
        assert.equal(F.f3.total, F.total2, 'el mismo total que la rechazada');
        assert.notEqual(F.f3.referencia, F.f2.referencia);
        await comprobante(F.f3.id, 'transferencia-correcta.png');
        assert.equal((await revisar(F.f3.id, { estado: 'Pagada' })).status, 200);
        assert.equal(await estadoDe(F.f3.id), 'Pagada');
        assert.equal(await estadoDe(F.f2.id), 'Rechazada', 'la rechazada queda como constancia');
        assert.equal((await familia('GET', '/api/cuentas/pagables')).data.items.length, 0, 'no queda nada por pagar');
    });

    it('8. los reportes cierran al centavo con lo que pagó la familia', async () => {
        for (const clave of ['n1', 'n2']) {
            const total = clave === 'n1' ? F.total1 : F.total2;
            const r = await reporte('pagos-por-alumno', `anio=${anio}&mes=${mes}&nivel_id=${F[clave].nivel}`);
            const alumno = seccion(r, 'Pagos por alumno').filas[0];
            assert.deepEqual([alumno.adeudado, alumno.pagado, alumno.pendiente, alumno.estado], [pesos(total), pesos(total), pesos(0), 'Completo'], clave);
        }
        // Ingresos del mes por concepto: la suma de lo que entró es lo que la familia transfirió en las dos facturas pagadas
        const ing = async (clave) => seccion(await reporte('ingresos', `anio=${anio}&mes=${mes}&nivel_id=${F[clave].nivel}`), 'Ingresos por mes').filas.at(-1);
        const i1 = await ing('n1');
        assert.deepEqual([i1.cuotas, i1.deporte, i1.comedor, i1.total], [pesos(F.n1.cuota), pesos(7000.35), pesos(F.comida), pesos(F.total1)]);
        const i2 = await ing('n2');
        assert.deepEqual([i2.cuotas, i2.transporte, i2.comedor, i2.total], [pesos(F.n2.cuota), pesos(9000.10), pesos(F.comida), pesos(F.total2)]);

        const deporte = seccion(await reporte('pagos-por-deporte', `mes=${mes}&anio=${anio}&nivel_id=${F.n1.nivel}`), 'Pagos por grupo').filas[0];
        assert.deepEqual([deporte.inscriptos, deporte.facturado, deporte.pagado, deporte.pendiente], [1, pesos(7000.35), pesos(7000.35), pesos(0)]);
        const recorrido = seccion(await reporte('pagos-por-recorrido', `mes=${mes}&anio=${anio}&ruta_id=${F.ruta}`), 'Pagos por recorrido').filas[0];
        assert.deepEqual([recorrido.inscriptos, recorrido.facturado, recorrido.pagado, recorrido.pendiente], [1, pesos(9000.10), pesos(9000.10), pesos(0)]);

        // El mismo número en tres lugares: lo facturado y aprobado, lo que muestra el historial de la familia y lo que dicen los reportes
        const historial = (await familia('GET', '/api/cuentas/historial')).data;
        assert.equal(historial.resumen.total_pagado, F.totalFamilia);
        const delPeriodo = [F.f1.id, F.f3.id];
        const pagadas = (await db.query("SELECT COALESCE(SUM(total), 0) AS t FROM facturas WHERE id = ANY($1) AND estado = 'Pagada'", [delPeriodo])).rows[0].t;
        assert.equal(Number(pagadas), F.totalFamilia);
        assert.equal(suma([i1.total.replace(/[^\d,]/g, '').replace(',', '.'), i2.total.replace(/[^\d,]/g, '').replace(',', '.')]), F.totalFamilia);
    });

    it('9. sin pérdida de datos: nada quedó huérfano, repetido ni con otro monto', async () => {
        const facturas = (await db.query('SELECT id, total, estado FROM facturas WHERE tutor_id = $1 ORDER BY id', [padre.id])).rows;
        assert.deepEqual(facturas.map((f) => f.estado), ['Pagada', 'Rechazada', 'Pagada']);
        for (const f of facturas) {
            const items = (await db.query('SELECT monto FROM factura_items WHERE factura_id = $1', [f.id])).rows;
            assert.equal(items.length, 3, `la factura ${f.id} conserva sus tres renglones`);
            assert.equal(suma(items.map((i) => i.monto)), Number(f.total), 'los renglones suman el total de la factura');
            const archivos = (await db.query('SELECT ruta_storage FROM comprobantes_pago WHERE factura_id = $1', [f.id])).rows;
            assert.equal(archivos.length, 1, 'cada factura conserva su comprobante, también la rechazada');
            assert.ok(almacen.archivos.has(archivos[0].ruta_storage), 'y el archivo sigue en Storage');
        }
        const pagos = (await db.query('SELECT cuota_id, monto_pagado FROM pagos WHERE alumno_id = ANY($1) ORDER BY cuota_id', [ids.alumnos])).rows;
        assert.equal(pagos.length, 2, 'un pago por cuota, ninguno repetido');
        assert.equal(suma(pagos.map((p) => p.monto_pagado)), suma([F.n1.cuota, F.n2.cuota]));
        const inscripciones = (await db.query("SELECT COUNT(*)::int AS n FROM inscripciones_servicio WHERE alumno_id = ANY($1) AND estado = 'Activa'", [ids.alumnos])).rows[0].n;
        assert.equal(inscripciones, 4, 'las inscripciones siguen activas');
        // Y los documentos se pueden generar sobre esos datos
        const enlace = await familia('GET', `/api/cuentas/pdf-enlace?tipo=factura&id=${F.f1.id}`);
        assert.equal(enlace.status, 200);
        const pdf = await api('GET', enlace.data.ruta);
        assert.equal(pdf.status, 200);
        assert.match(pdf.tipo, /pdf/);
        const csv = await admin('GET', `/api/reportes/pagos-por-alumno?anio=${anio}&mes=${mes}&nivel_id=${F.n1.nivel}&formato=csv`);
        assert.equal(csv.status, 200);
        assert.match(csv.data, /Flujo/);
    });
});

describe('Casos de borde entre módulos (HU13)', { skip }, () => {
    let server, base, db, tokenAdmin, tokenPadre, padre;
    const unico = Date.now();
    const azar = () => crypto.randomBytes(5).toString('hex');
    const claveFamilia = `Aa1!${crypto.randomBytes(8).toString('hex')}`;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [], padres: [] };
    const F = {};
    let almacen;

    async function api(method, path, { token, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    const admin = (method, path, body) => api(method, path, { token: tokenAdmin, body });
    const familia = (method, path, body) => api(method, path, { token: tokenPadre, body });
    const facturaConComprobante = async (items) => {
        const f = await familia('POST', '/api/cuentas/facturas', { items });
        assert.equal(f.status, 201, JSON.stringify(f.data));
        const c = await familia('POST', `/api/cuentas/facturas/${f.data.id}/comprobantes`, { nombre: 't.png', tipo_mime: 'image/png', contenido: PNG.toString('base64') });
        assert.equal(c.status, 201, JSON.stringify(c.data));
        return f.data;
    };
    const nuevoAlumno = async (apellido, estado = 'Activo') => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('Borde', $1, $2, '2015-05-05', $3, $4, $5) RETURNING id`,
            [apellido, `B${azar()}`, F.curso, padre.id, estado])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const nuevaCuota = async (m, a, monto) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id', [F.nivel, monto, m, a, `${a}-${String(m).padStart(2, '0')}-10`])).rows[0].id;
        ids.cuotas.push(id);
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
        const r = await admin('POST', '/api/auth/users', { nombre: 'Familia Borde', username: `hu13b-${unico}`, password: claveFamilia, rol: 'padre' });
        assert.equal(r.status, 201);
        padre = { id: r.data.id };
        ids.padres.push(padre.id);
        tokenPadre = await login(`hu13b-${unico}`, claveFamilia);
        F.nivel = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel borde ${unico}`])).rows[0].id;
        F.curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [F.nivel, 'A'])).rows[0].id;
        ids.niveles.push(F.nivel);
        ids.cursos.push(F.curso);
    });

    beforeEach(() => {
        almacen = almacen || {
            archivos: new Map(),
            async subir(ruta, buffer, tipo) { this.archivos.set(ruta, { buffer, tipo }); },
            async urlFirmada(ruta) { return `https://storage.invalido/${ruta}`; },
            async borrar(ruta) { this.archivos.delete(ruta); },
        };
        usarAlmacen(almacen);
    });

    after(async () => {
        usarAlmacen(undefined);
        if (ids.alumnos.length) {
            await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM saldos_alumnos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        }
        if (ids.padres.length) await db.query('DELETE FROM facturas WHERE tutor_id = ANY($1)', [ids.padres]);
        if (ids.alumnos.length) {
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        }
        if (ids.cuotas.length) await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        if (ids.cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        if (ids.niveles.length) await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        for (const id of ids.padres) await api('DELETE', `/api/auth/users/${id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
    });

    it('no se borra un alumno, una cuota ni una cuenta con facturas o pagos: se avisa con un 409 claro y no se pierde nada', async () => {
        const alumno = await nuevoAlumno('Historial');
        const cuota = await nuevaCuota(3, 2019, 15000);
        const f = await facturaConComprobante([{ tipo: 'cuota', alumno_id: alumno, cuota_id: cuota }]);
        assert.equal((await admin('PATCH', `/api/facturas/${f.id}/estado`, { estado: 'Pagada' })).status, 200);

        for (const [ruta, descripcion] of [[`/api/academico/alumnos/${alumno}`, 'alumno'], [`/api/financiero/cuotas-config/${cuota}`, 'cuota'], [`/api/auth/users/${padre.id}`, 'cuenta']]) {
            const r = await admin('DELETE', ruta);
            assert.equal(r.status, 409, `${descripcion}: ${JSON.stringify(r.data)}`);
            assert.ok(!/constraint|violates|relation|_fkey|factura_items/i.test(r.data.message), `${descripcion}: el mensaje no expone detalles de la base: ${r.data.message}`);
        }
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM alumnos WHERE id = $1', [alumno])).rows[0].n, 1);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pagos WHERE alumno_id = $1', [alumno])).rows[0].n, 1);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [padre.id])).rows[0].n, 1);
        // El historial sigue completo después de los intentos
        assert.equal((await familia('GET', '/api/cuentas/historial')).data.resumen.total_pagado, 15000);
    });

    it('una cuota que la Dirección cobró en mano después de facturarse no se cobra dos veces al aprobar la factura', async () => {
        const alumno = await nuevoAlumno('Doble');
        const cuota = await nuevaCuota(4, 2019, 12000);
        const f = await facturaConComprobante([{ tipo: 'cuota', alumno_id: alumno, cuota_id: cuota }]);
        // La Dirección registra el pago completo en secretaría mientras la factura espera revisión
        const manual = await admin('POST', '/api/financiero/pagos', { alumno_id: alumno, cuota_id: cuota, monto_pagado: 12000, metodo_pago: 'Efectivo' });
        assert.equal(manual.status, 201);
        const r = await admin('PATCH', `/api/facturas/${f.id}/estado`, { estado: 'Pagada' });
        assert.equal(r.status, 409, 'la cuota ya está saldada: la factura no se puede dar por pagada');
        assert.match(r.data.message, /ya recibió pagos/);
        const pagado = (await db.query('SELECT COALESCE(SUM(monto_pagado), 0) AS t FROM pagos WHERE cuota_id = $1', [cuota])).rows[0].t;
        assert.equal(Number(pagado), 12000, 'la cuota no queda pagada de más');
        assert.equal((await db.query('SELECT estado FROM facturas WHERE id = $1', [f.id])).rows[0].estado, 'En revision', 'la factura sigue en revisión para que la Dirección la anule');
        const anulada = await admin('PATCH', `/api/facturas/${f.id}/estado`, { estado: 'Rechazada', motivo: 'La cuota se cobró en secretaría' });
        assert.equal(anulada.status, 200, 'la Dirección sí puede anularla');
    });

    it('un alumno pasado a inactivo mientras su factura esperaba revisión igual se puede cobrar, y no se pierde el pago', async () => {
        const alumno = await nuevoAlumno('Inactivo');
        const cuota = await nuevaCuota(5, 2019, 9999.99);
        const f = await facturaConComprobante([{ tipo: 'cuota', alumno_id: alumno, cuota_id: cuota }]);
        await db.query("UPDATE alumnos SET estado = 'Inactivo' WHERE id = $1", [alumno]);
        const r = await admin('PATCH', `/api/facturas/${f.id}/estado`, { estado: 'Pagada' });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(Number((await db.query('SELECT monto_pagado FROM pagos WHERE factura_id = $1', [f.id])).rows[0].monto_pagado), 9999.99);
    });

    it('la familia no puede tocar la factura de otra: ni ver sus datos, ni subirle comprobantes, ni aprobarla', async () => {
        const alumno = await nuevoAlumno('Ajena');
        const cuota = await nuevaCuota(6, 2019, 5000);
        const f = await facturaConComprobante([{ tipo: 'cuota', alumno_id: alumno, cuota_id: cuota }]);
        const otro = await login('padre', 'padre123');
        assert.equal((await api('GET', `/api/cuentas/facturas/${f.id}`, { token: otro })).status, 403);
        assert.equal((await api('POST', `/api/cuentas/facturas/${f.id}/comprobantes`, { token: otro, body: { nombre: 'x.png', tipo_mime: 'image/png', contenido: PNG.toString('base64') } })).status, 403);
        assert.equal((await api('PATCH', `/api/facturas/${f.id}/estado`, { token: otro, body: { estado: 'Pagada' } })).status, 403);
        assert.equal((await db.query('SELECT estado FROM facturas WHERE id = $1', [f.id])).rows[0].estado, 'En revision');
    });
});
