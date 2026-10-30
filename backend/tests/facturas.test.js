// Factura consolidada del padre (HU7): reglas puras y API contra un PostgreSQL REAL.
// La parte de la API solo corre si DATABASE_URL apunta a localhost (crea cuotas, inscripciones y facturas de prueba).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { validarSeleccion, totalFactura, descripcionCuota, descripcionServicio, referenciaFactura, azarReferencia, datosBancarios, claveItem, MAX_ITEMS } = require('../src/utils/facturas');

describe('Factura: reglas puras', () => {
    it('acepta una selección válida y la normaliza (se descarta cualquier monto enviado)', () => {
        const r = validarSeleccion([{ tipo: 'cuota', alumno_id: 1, cuota_id: 2, monto: 1 }, { tipo: 'servicio', inscripcion_id: 3, precio: 1 }]);
        assert.deepEqual(r.items, [{ tipo: 'cuota', alumno_id: 1, cuota_id: 2 }, { tipo: 'servicio', inscripcion_id: 3 }]);
    });

    it('rechaza lo vacío, lo repetido, lo inválido y lo excesivo', () => {
        for (const mala of [undefined, null, 'x', [], [{}], [{ tipo: 'cuota', alumno_id: 1 }], [{ tipo: 'servicio', inscripcion_id: '3' }],
            [{ tipo: 'cuota', alumno_id: 1.5, cuota_id: 2 }], [{ tipo: 'efectivo', inscripcion_id: 3 }], [null]]) {
            assert.ok(validarSeleccion(mala).error, `debería rechazar ${JSON.stringify(mala)}`);
        }
        const repetido = validarSeleccion([{ tipo: 'servicio', inscripcion_id: 3 }, { tipo: 'servicio', inscripcion_id: 3 }]);
        assert.match(repetido.error, /repetido/);
        assert.equal(validarSeleccion([{ tipo: 'cuota', alumno_id: 1, cuota_id: 2 }, { tipo: 'cuota', alumno_id: 2, cuota_id: 2 }]).error, undefined, 'la misma cuota en dos hijos distintos no es un repetido');
        const muchos = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ tipo: 'servicio', inscripcion_id: i + 1 }));
        assert.match(validarSeleccion(muchos).error, /hasta 50/);
        assert.equal(validarSeleccion(muchos.slice(0, MAX_ITEMS)).error, undefined);
    });

    it('la clave distingue las cuotas por hijo y los servicios por inscripción', () => {
        assert.notEqual(claveItem({ tipo: 'cuota', alumno_id: 1, cuota_id: 2 }), claveItem({ tipo: 'cuota', alumno_id: 2, cuota_id: 2 }));
        assert.equal(claveItem({ tipo: 'servicio', inscripcion_id: 9 }), 'servicio:9');
    });

    it('el total se suma en centavos exactos', () => {
        assert.equal(totalFactura([{ monto: 0.1 }, { monto: 0.2 }]), 0.3);
        assert.equal(totalFactura([{ monto: 15000 }, { monto: 12345.67 }, { monto: 1.15 }]), 27346.82);
        assert.equal(totalFactura([{ monto: '8.20' }, { monto: 8.2 }]), 16.4);
        assert.equal(totalFactura([]), 0);
    });

    it('nombra cada ítem con su período y el hijo', () => {
        assert.equal(descripcionCuota({ mes: 3, anio: 2026, alumno: 'Paz, Ana' }), 'Cuota de Marzo 2026 - Paz, Ana');
        assert.equal(descripcionServicio({ tipo: 'Deporte', nombre: 'Fútbol', mes: 10, anio: 2026, alumno: 'Paz, Ana' }), 'Deporte: Fútbol (Octubre 2026) - Paz, Ana');
        assert.equal(descripcionServicio({ tipo: 'Comedor', nombre: 'Comedor mensual', mes: 1, anio: 2027, alumno: 'Paz, Ana' }), 'Comedor mensual (Enero 2027) - Paz, Ana');
    });

    it('la referencia lleva la fecha y seis caracteres sin confusiones (0/O, 1/I)', () => {
        assert.equal(referenciaFactura('2026-10-30', 'ABC234'), 'EPT-20261030-ABC234');
        for (let i = 0; i < 200; i++) assert.match(referenciaFactura('2026-10-30'), /^EPT-20261030-[A-HJ-NP-Z2-9]{6}$/);
        assert.equal(azarReferencia(() => 0), 'AAAAAA');
        assert.equal(azarReferencia(() => 0.999999), '999999');
    });

    it('los datos bancarios salen de la configuración y sin ellos son null', () => {
        assert.equal(datosBancarios({}), null);
        assert.deepEqual(datosBancarios({ PAGO_ALIAS: 'escuela.pagos', PAGO_CBU: '0000003100000000000001' }),
            { titular: undefined, banco: undefined, cbu: '0000003100000000000001', alias: 'escuela.pagos' });
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API de facturas del padre (HU7)', { skip }, () => {
    let server, base, db, tokenAdmin, tutor, token;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [] };
    const F = {};

    async function api(method, path, { token: t, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    let seq = 0;
    const dni = () => String(Date.now()).slice(-7) + String(++seq).padStart(2, '0');
    const alumno = async (apellido, cursoId) => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('Fac', $1, $2, '2015-05-05', $3, $4, 'Activo') RETURNING id`,
            [apellido, dni(), cursoId, tutor.id])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const cuota = async (nivelId, mes, anio, monto) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nivelId, monto, mes, anio, `${anio}-${String(mes).padStart(2, '0')}-10`])).rows[0].id;
        ids.cuotas.push(id);
        return id;
    };
    const item = (items, f) => items.find(f);
    const pagables = async () => (await api('GET', '/api/cuentas/pagables', { token })).data;
    const facturar = (items) => api('POST', '/api/cuentas/facturas', { token, body: { items } });

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');

        const username = `hu7-${Date.now()}`;
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Factura', username, password: 'Factura123!', rol: 'padre' } });
        assert.equal(r.status, 201);
        tutor = { id: r.data.id };
        token = await login(username, 'Factura123!');

        const nivelId = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU7 ${Date.now()}`])).rows[0].id;
        const cursoId = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [nivelId, 'A'])).rows[0].id;
        ids.niveles.push(nivelId);
        ids.cursos.push(cursoId);
        F.nivelId = nivelId;
        F.hijoA = await alumno('Alfa', cursoId);
        F.hijoB = await alumno('Beta', cursoId);

        F.marzo = await cuota(nivelId, 3, 2019, 15000);
        F.abril = await cuota(nivelId, 4, 2019, 12345.67);
        F.futura = await cuota(nivelId, 12, 2099, 15000);
        await db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, $2, 345.67, 'Transferencia')", [F.hijoA, F.abril]); // pago parcial: resta 12000
        await db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, $2, 15000, 'Transferencia')", [F.hijoB, F.marzo]); // pagada

        // Un servicio del catálogo del seed, inscripto (activo) en marzo de 2020 (el mínimo que admite la tabla) y otro mes dado de baja
        F.servicio = (await db.query("SELECT id, precio_mensual FROM servicios WHERE tipo = 'Comedor' ORDER BY id LIMIT 1")).rows[0];
        assert.ok(F.servicio, 'el seed trae el servicio de comedor');
        F.inscripcion = (await db.query("INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, 3, 2020) RETURNING id", [F.hijoA, F.servicio.id])).rows[0].id;
        await db.query("INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio, estado) VALUES ($1, $2, 4, 2020, 'Baja')", [F.hijoA, F.servicio.id]);
    });

    after(async () => {
        await db.query('DELETE FROM facturas WHERE tutor_id = $1', [tutor.id]); // los ítems se van en cascada
        if (ids.alumnos.length) {
            await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        }
        if (ids.cuotas.length) await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        if (ids.cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        if (ids.niveles.length) await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        if (tutor) await api('DELETE', `/api/auth/users/${tutor.id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('lista lo que se puede pagar: cuotas con su saldo y servicios activos, sin lo ya pagado ni lo dado de baja', async () => {
        const { items, total_disponible } = await pagables();
        const deA = items.filter((i) => i.alumno_id === F.hijoA);
        assert.deepEqual(deA.map((i) => [i.tipo, i.monto]).sort(), [['cuota', 12000], ['cuota', 15000], ['servicio', Number(F.servicio.precio_mensual)]].sort());
        assert.equal(item(deA, (i) => i.cuota_id === F.abril).monto, 12000, 'de la cuota parcial se cobra lo que resta');
        assert.equal(items.filter((i) => i.alumno_id === F.hijoB).length, 1, 'la cuota pagada de Beta no se ofrece; solo queda la de abril');
        assert.ok(!items.some((i) => i.cuota_id === F.futura), 'la cuota todavía no emitida no se ofrece');
        assert.ok(items.every((i) => i.disponible && i.en_factura === null));
        assert.equal(total_disponible, 15000 + 12000 + Number(F.servicio.precio_mensual) + 12345.67);
    });

    it('arma la factura con el total exacto calculado en el servidor y una referencia para la transferencia', async () => {
        const r = await facturar([
            { tipo: 'cuota', alumno_id: F.hijoA, cuota_id: F.marzo, monto: 1 }, // el monto que mande la app no cuenta
            { tipo: 'cuota', alumno_id: F.hijoA, cuota_id: F.abril },
            { tipo: 'servicio', inscripcion_id: F.inscripcion },
        ]);
        assert.equal(r.status, 201, JSON.stringify(r.data));
        F.factura = r.data;
        assert.equal(r.data.total, 15000 + 12000 + Number(F.servicio.precio_mensual));
        assert.equal(r.data.estado, 'Pendiente');
        assert.match(r.data.referencia, /^EPT-\d{8}-[A-HJ-NP-Z2-9]{6}$/);
        assert.equal(r.data.items.length, 3);
        assert.deepEqual(r.data.items.map((i) => i.monto).sort((a, b) => a - b), [12000, 15000, Number(F.servicio.precio_mensual)].sort((a, b) => a - b));
        assert.match(r.data.items.find((i) => i.cuota_id === F.marzo).descripcion, /^Cuota de Marzo 2019 - Alfa, Fac$/);
        assert.equal(r.data.pago.metodo, 'Transferencia bancaria');
        assert.match(r.data.pago.nota, /No se aceptan pagos en efectivo/);
    });

    it('lo ya facturado se muestra pero no se puede elegir de nuevo', async () => {
        const { items, total_disponible } = await pagables();
        const facturados = items.filter((i) => i.alumno_id === F.hijoA);
        assert.equal(facturados.length, 3);
        assert.ok(facturados.every((i) => !i.disponible && i.en_factura === F.factura.referencia));
        assert.equal(total_disponible, 12345.67, 'solo queda la cuota de abril de Beta');

        const otra = await facturar([{ tipo: 'cuota', alumno_id: F.hijoA, cuota_id: F.marzo }]);
        assert.equal(otra.status, 409);
        assert.ok(otra.data.message.includes(F.factura.referencia));
        const mezcla = await facturar([{ tipo: 'cuota', alumno_id: F.hijoB, cuota_id: F.abril }, { tipo: 'servicio', inscripcion_id: F.inscripcion }]);
        assert.equal(mezcla.status, 409, 'un solo ítem ya facturado frena la factura entera');
        assert.equal((await pagables()).total_disponible, 12345.67, 'y no se creó nada a medias');
    });

    it('no deja facturar lo ya abonado, lo no emitido, lo ajeno ni lo inventado', async () => {
        for (const mala of [
            { tipo: 'cuota', alumno_id: F.hijoB, cuota_id: F.marzo }, // ya pagada
            { tipo: 'cuota', alumno_id: F.hijoB, cuota_id: F.futura }, // todavía no emitida
            { tipo: 'cuota', alumno_id: F.hijoB, cuota_id: 999999999 },
            { tipo: 'servicio', inscripcion_id: 999999999 },
        ]) {
            const r = await facturar([mala]);
            assert.equal(r.status, 409, JSON.stringify(mala));
        }
        const ajeno = (await db.query('SELECT id FROM alumnos WHERE tutor_id IS DISTINCT FROM $1 LIMIT 1', [tutor.id])).rows[0];
        assert.equal((await facturar([{ tipo: 'cuota', alumno_id: ajeno.id, cuota_id: F.marzo }])).status, 409, 'un hijo de otra familia');
    });

    it('valida la selección antes de tocar la base', async () => {
        assert.equal((await facturar([])).status, 400);
        assert.equal((await api('POST', '/api/cuentas/facturas', { token, body: {} })).status, 400);
        assert.equal((await facturar([{ tipo: 'efectivo', inscripcion_id: 1 }])).status, 400);
        assert.equal((await facturar([{ tipo: 'servicio', inscripcion_id: F.inscripcion }, { tipo: 'servicio', inscripcion_id: F.inscripcion }])).status, 400);
    });

    it('ocho pedidos simultáneos por el mismo ítem: uno factura y los otros reciben 409', async () => {
        const pedido = [{ tipo: 'cuota', alumno_id: F.hijoB, cuota_id: F.abril }];
        const estados = (await Promise.all(Array.from({ length: 8 }, () => facturar(pedido)))).map((r) => r.status).sort();
        assert.deepEqual(estados, [201, 409, 409, 409, 409, 409, 409, 409]);
        const n = (await db.query('SELECT COUNT(*)::int AS n FROM factura_items WHERE alumno_id = $1 AND cuota_id = $2', [F.hijoB, F.abril])).rows[0].n;
        assert.equal(n, 1, 'el ítem quedó en una sola factura');
    });

    it('lista las facturas del padre y muestra el detalle solo al dueño', async () => {
        const lista = await api('GET', '/api/cuentas/facturas', { token });
        assert.equal(lista.status, 200);
        assert.equal(lista.data.facturas.length, 2);
        assert.equal(lista.data.facturas.find((f) => f.id === F.factura.id).items.length, 3);
        const detalle = await api('GET', `/api/cuentas/facturas/${F.factura.id}`, { token });
        assert.equal(detalle.status, 200);
        assert.equal(detalle.data.referencia, F.factura.referencia);
        assert.match(detalle.data.pago.nota, /efectivo/);
        const otroPadre = await login('padre', 'padre123');
        assert.equal((await api('GET', `/api/cuentas/facturas/${F.factura.id}`, { token: otroPadre })).status, 403);
        assert.equal((await api('GET', '/api/cuentas/facturas', { token: otroPadre })).data.facturas.every((f) => f.id !== F.factura.id), true);
        assert.equal((await api('GET', '/api/cuentas/facturas/999999999', { token })).status, 404);
        assert.equal((await api('GET', '/api/cuentas/facturas/abc', { token })).status, 400);
    });

    it('una factura rechazada libera sus ítems y una pagada los da por abonados', async () => {
        await db.query("UPDATE facturas SET estado = 'Rechazada' WHERE id = $1", [F.factura.id]);
        const libres = (await pagables()).items.filter((i) => i.alumno_id === F.hijoA);
        assert.equal(libres.length, 3);
        assert.ok(libres.every((i) => i.disponible), 'vuelven a poder elegirse');

        const nueva = await facturar([{ tipo: 'cuota', alumno_id: F.hijoA, cuota_id: F.marzo }, { tipo: 'servicio', inscripcion_id: F.inscripcion }]);
        assert.equal(nueva.status, 201);
        await db.query("UPDATE facturas SET estado = 'Pagada', pagada_en = NOW() WHERE id = $1", [nueva.data.id]);
        const { items } = await pagables();
        assert.ok(!items.some((i) => i.inscripcion_id === F.inscripcion), 'el servicio abonado ya no se ofrece');
        assert.ok(!items.some((i) => i.cuota_id === F.marzo && i.alumno_id === F.hijoA), 'ni la cuota abonada');
        const pagadas = await api('GET', `/api/cuentas/cuotas?estado=pagadas&alumno_id=${F.hijoA}`, { token });
        assert.deepEqual(pagadas.data.cuotas.map((c) => c.mes), [3], 'HU6 la muestra como pagada');
    });

    it('solo el padre puede usar los endpoints de pago', async () => {
        const otros = [tokenAdmin, await login('docente', 'docente123'), await login('alumno', 'alumno123'), undefined];
        for (const t of otros) {
            assert.equal((await api('GET', '/api/cuentas/pagables', { token: t })).status, 403);
            assert.equal((await api('POST', '/api/cuentas/facturas', { token: t, body: { items: [{ tipo: 'servicio', inscripcion_id: 1 }] } })).status, 403);
            assert.equal((await api('GET', '/api/cuentas/facturas', { token: t })).status, 403);
        }
    });

    it('el bloqueo por padre serializa los pedidos: mientras otro está facturando, el segundo espera', async () => {
        // Se toma el mismo bloqueo (clase 7001 y el id del padre) que usa la creación de la factura. Si el pedido no lo respetara, terminaría de inmediato.
        const mayo = await cuota(F.nivelId, 5, 2019, 9999.99);
        const otro = await db.getClient();
        await otro.query('BEGIN');
        await otro.query('SELECT pg_advisory_xact_lock($1, $2)', [7001, tutor.id]);
        let termino = false;
        const pedido = facturar([{ tipo: 'cuota', alumno_id: F.hijoB, cuota_id: mayo }]).then((r) => { termino = true; return r; });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const esperaba = !termino;
        await otro.query('COMMIT');
        otro.release();
        const r = await pedido;
        assert.equal(esperaba, true, 'el pedido tenía que esperar el bloqueo del padre');
        assert.equal(r.status, 201);
    });
});
