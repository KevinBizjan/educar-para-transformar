// Historial de la app móvil por hijo (HU9 completada): las facturas de un período con sus comprobantes, acotadas a un
// alumno. Se prueba contra un PostgreSQL local, con un Storage falso.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { usarAlmacen } = require('../src/services/almacenamiento');

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

// PNG válido mínimo (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Historial por hijo con comprobantes', { skip }, () => {
    let server, base, db, tokenAdmin, token, padre, almacen;
    const ids = { alumnos: [], cuotas: [], cursos: [], niveles: [] };
    const F = {};
    const azar = () => crypto.randomBytes(5).toString('hex');
    const clave = `Aa1!${crypto.randomBytes(8).toString('hex')}`;

    async function api(method, path, { token: t, body } = {}) {
        const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const tipo = res.headers.get('content-type') || '';
        let data = null;
        if (tipo.includes('json')) { try { data = await res.json(); } catch { /* sin JSON */ } } else data = Buffer.from(await res.arrayBuffer());
        return { status: res.status, data, tipo };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    const hist = (consulta = '', t = token) => api('GET', `/api/cuentas/historial${consulta}`, { token: t });
    const factura = async (items) => {
        const f = await api('POST', '/api/cuentas/facturas', { token, body: { items } });
        assert.equal(f.status, 201, JSON.stringify(f.data));
        return f.data;
    };
    const comprobante = async (facturaId, nombre) => {
        const r = await api('POST', `/api/cuentas/facturas/${facturaId}/comprobantes`, { token, body: { nombre, tipo_mime: 'image/png', contenido: PNG.toString('base64') } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
    };
    const alumno = async (apellido, tutorId) => {
        const id = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, estado) VALUES ('His', $1, $2, '2015-05-05', $3, $4, 'Activo') RETURNING id`,
            [apellido, `H${azar()}`, F.curso, tutorId])).rows[0].id;
        ids.alumnos.push(id);
        return id;
    };
    const cuota = async (mes, monto) => {
        const id = (await db.query('INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, 2019, $4) RETURNING id', [F.nivel, monto, mes, `2019-${String(mes).padStart(2, '0')}-10`])).rows[0].id;
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
        const username = `hist-${Date.now()}`;
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Historial', username, password: clave, rol: 'padre' } });
        assert.equal(r.status, 201);
        padre = r.data.id;
        token = await login(username, clave);
        F.nivel = (await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [`Nivel historial ${Date.now()}`])).rows[0].id;
        F.curso = (await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, 10) RETURNING id', [F.nivel, 'A'])).rows[0].id;
        ids.niveles.push(F.nivel);
        ids.cursos.push(F.curso);
        F.ana = await alumno('Ana', padre);
        F.beto = await alumno('Beto', padre);
        F.ajeno = await alumno('Ajeno', null);
        F.c1 = await cuota(3, 15000.5);
        F.c2 = await cuota(4, 12000.1);
        // Factura 1: una cuota de cada hijo. Factura 2: solo de Beto
        F.f1 = await factura([{ tipo: 'cuota', alumno_id: F.ana, cuota_id: F.c1 }, { tipo: 'cuota', alumno_id: F.beto, cuota_id: F.c1 }]);
        F.f2 = await factura([{ tipo: 'cuota', alumno_id: F.beto, cuota_id: F.c2 }]);
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
        await db.query('DELETE FROM pagos WHERE alumno_id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM facturas WHERE tutor_id = $1', [padre]);
        await db.query('DELETE FROM alumnos WHERE id = ANY($1)', [ids.alumnos]);
        await db.query('DELETE FROM cuotas_config WHERE id = ANY($1)', [ids.cuotas]);
        await db.query('DELETE FROM cursos WHERE id = ANY($1)', [ids.cursos]);
        await db.query('DELETE FROM niveles WHERE id = ANY($1)', [ids.niveles]);
        await api('DELETE', `/api/auth/users/${padre}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        await db.end();
    });

    it('cada factura trae sus comprobantes (sin la ruta de Storage) y la lista vacía si todavía no tiene', async () => {
        await comprobante(F.f1.id, 'transferencia-1.png');
        await comprobante(F.f1.id, 'transferencia-2.png');
        const r = await hist();
        assert.equal(r.status, 200);
        const f1 = r.data.facturas.find((f) => f.id === F.f1.id);
        const f2 = r.data.facturas.find((f) => f.id === F.f2.id);
        assert.deepEqual(f1.comprobantes.map((c) => c.nombre_archivo), ['transferencia-1.png', 'transferencia-2.png']);
        assert.deepEqual(f2.comprobantes, []);
        assert.ok(f1.comprobantes.every((c) => c.id && c.tipo_mime === 'image/png' && c.tamano_bytes > 0 && !('ruta_storage' in c)));
        assert.equal(r.data.alumno_id, null);
        assert.equal(f1.items.length, 2, 'sin filtro se ven todos los renglones');
    });

    it('al elegir un hijo solo figuran las facturas que lo incluyen, con sus renglones y su parte del total', async () => {
        const ana = (await hist(`?alumno_id=${F.ana}`)).data;
        assert.equal(ana.alumno_id, F.ana);
        assert.deepEqual(ana.facturas.map((f) => f.id), [F.f1.id], 'la factura 2 no la incluye');
        const f1 = ana.facturas[0];
        assert.deepEqual(f1.items.map((i) => [i.alumno, i.monto]), [['Ana, His', 15000.5]]);
        assert.equal(f1.total, 15000.5, 'su parte, no el total de la factura');
        assert.equal(f1.total_factura, 30001, 'el total de la factura completa se conserva aparte');
        assert.equal(f1.comprobantes.length, 2, 'los comprobantes son de la factura y siguen a la vista');
        assert.equal(ana.resumen.total_facturado, 15000.5);
        assert.equal(ana.resumen.total_pendiente, 15000.5);

        const beto = (await hist(`?alumno_id=${F.beto}`)).data;
        assert.deepEqual(beto.facturas.map((f) => f.id).sort(), [F.f1.id, F.f2.id].sort());
        assert.equal(beto.resumen.total_facturado, 27000.6, 'suma en centavos exactos: 15000,50 + 12000,10');
        assert.equal((await hist('')).data.resumen.total_facturado, 42001.1, 'sin filtro es la suma de las dos facturas: 30001,00 + 12000,10');
    });

    it('el filtro por hijo se combina con el rango de fechas', async () => {
        const hoy = new Date().toISOString().slice(0, 10);
        assert.equal((await hist(`?alumno_id=${F.ana}&desde=${hoy}&hasta=${hoy}`)).data.facturas.length, 1);
        assert.equal((await hist(`?alumno_id=${F.ana}&hasta=2019-12-31`)).data.facturas.length, 0);
    });

    it('los pagos de la institución también se acotan al hijo', async () => {
        await db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, NULL, 500, 'Efectivo en secretaría')", [F.ana]);
        await db.query("INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, NULL, 700, 'Efectivo en secretaría')", [F.beto]);
        assert.deepEqual((await hist(`?alumno_id=${F.ana}`)).data.otros_pagos.map((p) => p.monto), [500]);
        assert.equal((await hist('')).data.otros_pagos.length, 2);
    });

    it('valida al hijo: inválido es 400, inexistente 404 y de otra familia 403', async () => {
        assert.equal((await hist('?alumno_id=abc')).status, 400);
        assert.equal((await hist('?alumno_id=-3')).status, 400);
        assert.equal((await hist('?alumno_id=999999999')).status, 404);
        assert.equal((await hist(`?alumno_id=${F.ajeno}`)).status, 403);
        const otro = await login('padre', 'padre123');
        assert.equal((await hist(`?alumno_id=${F.ana}`, otro)).status, 403, 'tampoco los hijos de esta familia se ven desde otra cuenta');
        assert.equal((await hist('', null)).status, 403);
    });

    it('el PDF del historial también se puede acotar a un hijo, con las mismas validaciones', async () => {
        const enlace = await api('GET', `/api/cuentas/pdf-enlace?tipo=historial&alumno_id=${F.ana}`, { token });
        assert.equal(enlace.status, 200);
        const pdf = await api('GET', enlace.data.ruta);
        assert.equal(pdf.status, 200);
        assert.match(pdf.tipo, /pdf/);
        assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
        assert.equal((await api('GET', `/api/cuentas/pdf-enlace?tipo=historial&alumno_id=${F.ajeno}`, { token })).status, 403);
        assert.equal((await api('GET', '/api/cuentas/pdf-enlace?tipo=historial&alumno_id=abc', { token })).status, 400);
    });
});
