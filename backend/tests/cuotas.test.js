// Cuotas del padre/tutor (HU6): reglas puras y consulta de la API contra un PostgreSQL REAL.
// La parte de la API solo corre si DATABASE_URL apunta a localhost (crea cuotas, pagos y facturas de prueba).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { aCentavos, hoyEnArgentina, estadoCuota, armarCuota, filtrarCuotas, sumar, totalPendiente } = require('../src/utils/cuotas');

describe('Cuotas: reglas puras', () => {
    const HOY = '2026-10-15';

    it('los importes se comparan en centavos, sin errores de coma flotante', () => {
        assert.equal(aCentavos(0.1 + 0.2), 30);
        assert.equal(aCentavos('15000.50'), 1500050);
        assert.equal(aCentavos(null), 0);
        assert.equal(aCentavos(1.15), 115, '1,15 por 100 da 114,99999999999999 en coma flotante');
        assert.equal(aCentavos(8.2), 820);
        assert.equal(sumar([0.1, 0.2]), 0.3);
        assert.equal(sumar([12345.67, 10000]), 22345.67);
    });

    it('el estado sale de lo abonado, de la revisión y del vencimiento', () => {
        assert.equal(estadoCuota({ monto: 15000, pagado: 15000, vencimiento: '2026-03-10' }, HOY), 'Pagada');
        assert.equal(estadoCuota({ monto: 15000, pagado: 16000, vencimiento: '2026-03-10' }, HOY), 'Pagada', 'un pago de más también la cubre');
        assert.equal(estadoCuota({ monto: 15000, pagado: 5000, vencimiento: '2026-03-10' }, HOY), 'Vencida');
        assert.equal(estadoCuota({ monto: 15000, pagado: 0, vencimiento: '2026-10-15' }, HOY), 'Pendiente', 'el día del vencimiento todavía no está vencida');
        assert.equal(estadoCuota({ monto: 15000, pagado: 0, vencimiento: '2026-10-16' }, HOY), 'Pendiente');
        assert.equal(estadoCuota({ monto: 15000, pagado: 0, vencimiento: '2026-10-14' }, HOY), 'Vencida');
        assert.equal(estadoCuota({ monto: 15000, pagado: 0, vencimiento: '2026-03-10', enRevision: true }, HOY), 'En revision');
        assert.equal(estadoCuota({ monto: 15000, pagado: 15000, vencimiento: '2026-03-10', enRevision: true }, HOY), 'Pagada', 'lo pagado gana sobre la revisión');
        assert.equal(estadoCuota({ monto: 15000, pagado: 0, vencimiento: null }, HOY), 'Pendiente', 'sin vencimiento no puede estar vencida');
    });

    it('arma la cuota con el saldo exacto y una factura pagada la cubre', () => {
        const fila = { cuota_id: 1, alumno_id: 2, nombre: 'Ana', apellido: 'Paz', mes: 4, anio: 2026, monto: 12345.67, pagado: 0.67, vencimiento: '2026-04-10', facturada_pagada: false, en_revision: false };
        const c = armarCuota(fila, HOY);
        assert.equal(c.saldo, 12345);
        assert.equal(c.pagado, 0.67);
        assert.equal(c.alumno, 'Paz, Ana');
        assert.equal(c.estado, 'Vencida');
        const cubierta = armarCuota({ ...fila, pagado: 0, facturada_pagada: true }, HOY);
        assert.equal(cubierta.estado, 'Pagada');
        assert.equal(cubierta.saldo, 0);
        assert.equal(armarCuota({ ...fila, pagado: 99999 }, HOY).pagado, 12345.67, 'lo abonado no supera el importe');
    });

    it('filtra pendientes y pagadas y suma solo lo que se debe', () => {
        const cuotas = [
            { estado: 'Pagada', saldo: 0 }, { estado: 'Vencida', saldo: 10000 },
            { estado: 'En revision', saldo: 12345.67 }, { estado: 'Pendiente', saldo: 0.1 },
        ];
        assert.equal(filtrarCuotas(cuotas, 'pendientes').length, 3);
        assert.equal(filtrarCuotas(cuotas, 'pagadas').length, 1);
        assert.equal(totalPendiente(cuotas), 22345.77);
        assert.equal(totalPendiente([{ estado: 'Pagada', saldo: 0 }]), 0);
    });

    it('la fecha de hoy se toma en hora de Argentina, no en UTC', () => {
        assert.equal(hoyEnArgentina(new Date('2026-10-16T01:30:00Z')), '2026-10-15', '01:30 UTC todavía es el 15 en Argentina');
        assert.equal(hoyEnArgentina(new Date('2026-10-16T03:30:00Z')), '2026-10-16');
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API de cuotas del padre (HU6)', { skip }, () => {
    let server, base, db, tokenAdmin, tokenPadre, tutor;
    const ids = { alumnos: [], cuotas: [], facturas: [], cursos: [], niveles: [] };
    const F = {};

    async function api(method, path, token) {
        const res = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const login = async (username, password) => {
        const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        return (await res.json()).token;
    };
    let seq = 0;
    const dni = () => String(Date.now()).slice(-7) + String(++seq).padStart(2, '0');
    const alumno = async (apellido, cursoId) => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado)
             VALUES ('Cuo', $1, $2, '2015-05-05', $3, $4, 'Activo') RETURNING id`, [apellido, dni(), cursoId, tutor.id])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const cuota = async (nivelId, mes, anio, monto, vencimiento) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nivelId, monto, mes, anio, vencimiento])).rows[0].id;
        ids.cuotas.push(id);
        return id;
    };
    const pago = (alumnoId, cuotaId, monto) => db.query('INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, $2, $3, $4)', [alumnoId, cuotaId, monto, 'Transferencia']);
    const factura = async (estado, alumnoId, cuotaId, monto) => {
        const f = (await db.query('INSERT INTO facturas (tutor_id, referencia, total, estado) VALUES ($1, $2, $3, $4) RETURNING id', [tutor.id, `HU6-${Date.now()}-${++seq}`, monto, estado])).rows[0].id;
        ids.facturas.push(f);
        await db.query('INSERT INTO factura_items (factura_id, alumno_id, cuota_id, descripcion, monto) VALUES ($1, $2, $3, $4, $5)', [f, alumnoId, cuotaId, 'Cuota de prueba', monto]);
    };

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');
        tokenPadre = await login('padre', 'padre123');

        // Un tutor propio, para que las cuotas y pagos de la demostración no se mezclen con los de la prueba
        const username = `hu6-${Date.now()}`;
        const r = await fetch(`${base}/api/auth/users`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
            body: JSON.stringify({ nombre: 'Familia Cuotas', username, password: 'Cuotas123!', rol: 'padre' }),
        });
        assert.equal(r.status, 201);
        tutor = { id: (await r.json()).id, username };
        F.token = await login(username, 'Cuotas123!');

        // Dos niveles y cursos propios: así las cuotas de demostración del seed no se mezclan con las de la prueba
        const cursos = [];
        for (const letra of ['A', 'B']) {
            const nivelId = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel HU6 ${letra} ${Date.now()}`])).rows[0].id;
            const cursoId = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [nivelId, letra])).rows[0].id;
            ids.niveles.push(nivelId);
            ids.cursos.push(cursoId);
            cursos.push({ id: cursoId, nivel_id: nivelId });
        }
        F.hijoA = await alumno('Alfa', cursos[0].id);
        F.hijoB = await alumno('Beta', cursos[1].id);
        F.hijoSinCurso = await alumno('Gamma', null);

        // Nivel 1: marzo pagada, abril pagada en parte, mayo en revisión, diciembre de 2099 todavía no emitida
        const marzo = await cuota(cursos[0].nivel_id, 3, 2019, 15000, '2019-03-10');
        const abril = await cuota(cursos[0].nivel_id, 4, 2019, 15000, '2019-04-10');
        const mayo = await cuota(cursos[0].nivel_id, 5, 2019, 12345.67, '2019-05-10');
        await cuota(cursos[0].nivel_id, 12, 2099, 15000, '2099-12-10');
        await pago(F.hijoA, marzo, 15000);
        await pago(F.hijoA, abril, 5000);
        await factura('En revision', F.hijoA, mayo, 12345.67);
        // Nivel 2: marzo pagada, abril cubierta por una factura pagada (sin pago suelto)
        const marzo2 = await cuota(cursos[1].nivel_id, 3, 2019, 18000, '2019-03-10');
        const abril2 = await cuota(cursos[1].nivel_id, 4, 2019, 18000, '2019-04-10');
        await pago(F.hijoB, marzo2, 18000);
        await factura('Pagada', F.hijoB, abril2, 18000);
    });

    after(async () => {
        if (ids.alumnos.length) {
            await db.query('DELETE FROM factura_items WHERE alumno_id = ANY($1)', [ids.alumnos]);
            await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        }
        if (ids.facturas.length) await db.query('DELETE FROM facturas WHERE id = ANY($1)', [ids.facturas]);
        if (ids.alumnos.length) await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        if (ids.cuotas.length) await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        if (ids.cursos.length) await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        if (ids.niveles.length) await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        if (tutor) await fetch(`${base}/api/auth/users/${tutor.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenAdmin}` } });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('lista las cuotas pendientes con importes, vencimientos, estado y el total que se debe', async () => {
        const r = await api('GET', `/api/cuentas/cuotas?alumno_id=${F.hijoA}`, F.token);
        assert.equal(r.status, 200);
        assert.equal(r.data.filtro, 'pendientes');
        assert.deepEqual(r.data.cuotas.map((c) => [c.mes, c.estado]), [[5, 'En revision'], [4, 'Vencida']], 'de la más nueva a la más vieja');
        const abril = r.data.cuotas[1];
        assert.deepEqual([abril.monto, abril.pagado, abril.saldo, abril.vencimiento], [15000, 5000, 10000, '2019-04-10']);
        assert.equal(r.data.cuotas[0].saldo, 12345.67);
        assert.equal(r.data.total_pendiente, 22345.67, 'suma exacta, sin errores de centavos');
        assert.equal(r.data.hay_deuda, true);
    });

    it('lista las pagadas, y la cuota de una factura pagada cuenta como pagada', async () => {
        const a = await api('GET', `/api/cuentas/cuotas?estado=pagadas&alumno_id=${F.hijoA}`, F.token);
        assert.deepEqual(a.data.cuotas.map((c) => c.mes), [3]);
        assert.equal(a.data.cuotas[0].saldo, 0);
        const b = await api('GET', `/api/cuentas/cuotas?estado=pagadas&alumno_id=${F.hijoB}`, F.token);
        assert.deepEqual(b.data.cuotas.map((c) => [c.mes, c.estado]), [[4, 'Pagada'], [3, 'Pagada']]);
    });

    it('sin deuda devuelve la lista vacía y hay_deuda en falso (la app muestra el mensaje)', async () => {
        const r = await api('GET', `/api/cuentas/cuotas?alumno_id=${F.hijoB}`, F.token);
        assert.equal(r.status, 200);
        assert.deepEqual(r.data.cuotas, []);
        assert.equal(r.data.total_pendiente, 0);
        assert.equal(r.data.hay_deuda, false);
    });

    it('sin indicar hijo reúne a todos, no muestra cuotas futuras ni las de un hijo sin curso', async () => {
        const r = await api('GET', '/api/cuentas/cuotas?estado=pagadas', F.token);
        const alumnos = new Set(r.data.cuotas.map((c) => c.alumno_id));
        assert.deepEqual([...alumnos].sort(), [F.hijoA, F.hijoB].sort());
        assert.ok(!alumnos.has(F.hijoSinCurso));
        const todas = await api('GET', '/api/cuentas/cuotas', F.token);
        assert.ok(todas.data.cuotas.every((c) => c.anio < 2099), 'la cuota de diciembre de 2099 todavía no se emitió');
        assert.equal(todas.data.total_pendiente, 22345.67);
    });

    it('el historial trae los pagos registrados con su fecha, método y cuota, y el total abonado', async () => {
        const r = await api('GET', '/api/cuentas/cuotas?estado=historial', F.token);
        assert.equal(r.status, 200);
        assert.equal(r.data.pagos.length, 3);
        assert.equal(r.data.total_pagado, 38000);
        const abril = r.data.pagos.find((p) => p.monto === 5000);
        assert.deepEqual([abril.cuota_mes, abril.cuota_anio, abril.metodo_pago], [4, 2019, 'Transferencia']);
        assert.ok(abril.fecha_pago);
        const solo = await api('GET', `/api/cuentas/cuotas?estado=historial&alumno_id=${F.hijoA}`, F.token);
        assert.equal(solo.data.total_pagado, 20000);
    });

    it('solo el padre accede, solo a sus hijos, y valida los datos del pedido', async () => {
        assert.equal((await api('GET', '/api/cuentas/cuotas')).status, 403, 'sin sesión (igual que el resto de la API)');
        for (const token of [tokenAdmin, await login('docente', 'docente123'), await login('alumno', 'alumno123')]) {
            assert.equal((await api('GET', '/api/cuentas/cuotas', token)).status, 403);
        }
        const ajeno = (await db.query('SELECT id FROM alumnos WHERE tutor_id IS DISTINCT FROM $1 LIMIT 1', [tutor.id])).rows[0];
        assert.equal((await api('GET', `/api/cuentas/cuotas?alumno_id=${ajeno.id}`, F.token)).status, 403);
        assert.equal((await api('GET', '/api/cuentas/cuotas?estado=otro', F.token)).status, 400);
        assert.equal((await api('GET', '/api/cuentas/cuotas?alumno_id=abc', F.token)).status, 400);
        // El padre de la demostración no ve a los hijos de otra familia
        assert.equal((await api('GET', `/api/cuentas/cuotas?alumno_id=${F.hijoA}`, tokenPadre)).status, 403);
    });
});
