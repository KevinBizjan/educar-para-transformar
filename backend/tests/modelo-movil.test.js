// Pruebas del modelo de datos de la app móvil (HU1): facturas, comprobantes, servicios e
// inscripciones. Verifican que la base RECHACE datos o relaciones inválidas y que la relación
// 1:N factura -> comprobantes funcione. Solo corren contra un PostgreSQL local, igual que
// api.test.js, porque crean y borran filas.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dbUrl = process.env.DATABASE_URL || '';
const esBaseLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl);
const skip = esBaseLocal
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

// Códigos de error de PostgreSQL
const CHECK = '23514';
const FK = '23503';
const UNICO = '23505';

describe('Modelo de datos móvil (HU1)', { skip }, () => {
    let db;
    const sufijo = String(Date.now());
    let seq = 0;
    const unico = (base) => `${base}-${sufijo}-${++seq}`;
    const ids = { tutor: null, alumno: null, servicio: null, cuota: null };

    // Ejecuta una consulta que debe ser rechazada por la base con el código indicado.
    async function rechaza(sql, params, codigo) {
        await assert.rejects(
            () => db.query(sql, params),
            (err) => { assert.equal(err.code, codigo, `se esperaba ${codigo} y llegó ${err.code}: ${err.message}`); return true; }
        );
    }
    const nuevaFactura = async (total = 1000) => {
        const r = await db.query(
            'INSERT INTO facturas (tutor_id, referencia, total) VALUES ($1, $2, $3) RETURNING id',
            [ids.tutor, unico('REF'), total]
        );
        return r.rows[0].id;
    };
    const nuevoComprobante = (facturaId, ruta = unico('comprobantes/archivo'), mime = 'image/png') => db.query(
        `INSERT INTO comprobantes_pago (factura_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, subido_por)
         VALUES ($1, 'transferencia', $2, $3, 2048, $4) RETURNING id`,
        [facturaId, ruta, mime, ids.tutor]
    );

    before(async () => {
        db = require('../src/config/database');
        await db.ready;
        ids.tutor = (await db.query(
            "INSERT INTO users (username, password, nombre, rol) VALUES ($1, 'x', 'Tutor Prueba', 'padre') RETURNING id",
            [unico('tutor')]
        )).rows[0].id;
        ids.alumno = (await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, tutor_id)
             VALUES ('Alumno', 'Modelo', $1, '2015-05-05', $2) RETURNING id`,
            [String(Date.now()).slice(-8), ids.tutor]
        )).rows[0].id;
        ids.servicio = (await db.query(
            "INSERT INTO servicios (tipo, nombre, precio_mensual) VALUES ('Comedor', $1, 5000) RETURNING id",
            [unico('Comedor')]
        )).rows[0].id;
        ids.cuota = (await db.query(
            'INSERT INTO cuotas_config (monto, mes, anio) VALUES (20000, 3, 2027) RETURNING id'
        )).rows[0].id;
    });

    after(async () => {
        if (!db) return;
        // Se borra en orden inverso a las dependencias; los comprobantes e ítems caen por ON DELETE CASCADE.
        await db.query('DELETE FROM facturas WHERE tutor_id = $1', [ids.tutor]);
        await db.query('DELETE FROM inscripciones_servicio WHERE alumno_id = $1', [ids.alumno]);
        await db.query('DELETE FROM servicios WHERE id = $1', [ids.servicio]);
        await db.query('DELETE FROM servicios WHERE nombre LIKE $1', [`%-${sufijo}-%`]);
        await db.query('DELETE FROM cuotas_config WHERE id = $1', [ids.cuota]);
        await db.query('DELETE FROM alumnos WHERE id = $1', [ids.alumno]);
        await db.query('DELETE FROM users WHERE id = $1', [ids.tutor]);
        await db.end();
    });

    it('las 5 tablas nuevas existen y tienen RLS activado', async () => {
        const tablas = ['servicios', 'inscripciones_servicio', 'facturas', 'factura_items', 'comprobantes_pago'];
        const r = await db.query(
            'SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind = \'r\'', [tablas]
        );
        assert.equal(r.rows.length, tablas.length, 'falta alguna tabla');
        for (const fila of r.rows) assert.equal(fila.relrowsecurity, true, `${fila.relname} sin RLS`);
    });

    describe('servicios', () => {
        it('rechaza precios iguales o menores a cero', async () => {
            await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual) VALUES ('Comedor', $1, 0)", [unico('Cero')], CHECK);
            await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual) VALUES ('Comedor', $1, -10)", [unico('Neg')], CHECK);
        });
        it('rechaza un tipo inexistente y cupos no positivos', async () => {
            await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual) VALUES ('Piscina', $1, 100)", [unico('Tipo')], CHECK);
            await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max) VALUES ('Comedor', $1, 100, 0)", [unico('Cupo')], CHECK);
        });
        it('una ruta solo puede asociarse a un servicio de Transporte', async () => {
            const ruta = (await db.query("INSERT INTO transporte_rutas (nombre_ruta, capacidad_max) VALUES ($1, 20) RETURNING id", [unico('Ruta')])).rows[0].id;
            try {
                await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Deporte', $1, 100, $2)", [unico('Mal'), ruta], CHECK);
                const ok = await db.query("INSERT INTO servicios (tipo, nombre, precio_mensual, ruta_id) VALUES ('Transporte', $1, 100, $2) RETURNING id", [unico('Bien'), ruta]);
                assert.ok(ok.rows[0].id);
            } finally {
                await db.query('DELETE FROM servicios WHERE ruta_id = $1', [ruta]);
                await db.query('DELETE FROM transporte_rutas WHERE id = $1', [ruta]);
            }
        });
        it('rechaza referencias a actividades o rutas que no existen', async () => {
            await rechaza("INSERT INTO servicios (tipo, nombre, precio_mensual, actividad_id) VALUES ('Deporte', $1, 100, 2147483000)", [unico('Fk')], FK);
        });
    });

    describe('inscripciones a servicios', () => {
        it('rechaza meses fuera de 1 a 12 y alumnos inexistentes', async () => {
            await rechaza('INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, 13, 2027)', [ids.alumno, ids.servicio], CHECK);
            await rechaza('INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES (2147483000, $1, 3, 2027)', [ids.servicio], FK);
        });
        it('no permite inscribir dos veces al mismo servicio en el mismo mes, pero sí en otro mes', async () => {
            const alta = (mes) => db.query(
                'INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, $3, 2027) RETURNING id',
                [ids.alumno, ids.servicio, mes]
            );
            await alta(4);
            await assert.rejects(() => alta(4), (err) => err.code === UNICO);
            assert.ok((await alta(5)).rows[0].id); // el transporte puede variar mes a mes
        });
    });

    describe('facturas', () => {
        it('rechaza totales iguales o menores a cero y estados inválidos', async () => {
            await rechaza("INSERT INTO facturas (tutor_id, referencia, total) VALUES ($1, $2, 0)", [ids.tutor, unico('REF')], CHECK);
            await rechaza("INSERT INTO facturas (tutor_id, referencia, total, estado) VALUES ($1, $2, 100, 'Perdida')", [ids.tutor, unico('REF')], CHECK);
        });
        it('rechaza tutores inexistentes y referencias repetidas', async () => {
            await rechaza("INSERT INTO facturas (tutor_id, referencia, total) VALUES (2147483000, $1, 100)", [unico('REF')], FK);
            const ref = unico('REF-UNICA');
            await db.query('INSERT INTO facturas (tutor_id, referencia, total) VALUES ($1, $2, 100)', [ids.tutor, ref]);
            await rechaza('INSERT INTO facturas (tutor_id, referencia, total) VALUES ($1, $2, 100)', [ids.tutor, ref], UNICO);
        });
    });

    describe('ítems de factura', () => {
        it('cada ítem es una cuota o un servicio, nunca ambos ni ninguno', async () => {
            const factura = await nuevaFactura();
            const insc = (await db.query(
                'INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, 6, 2027) RETURNING id',
                [ids.alumno, ids.servicio]
            )).rows[0].id;
            const item = (cuota, inscripcion, monto = 100) => db.query(
                `INSERT INTO factura_items (factura_id, alumno_id, cuota_id, inscripcion_id, descripcion, monto)
                 VALUES ($1, $2, $3, $4, 'ítem', $5)`, [factura, ids.alumno, cuota, inscripcion, monto]);
            await assert.rejects(() => item(null, null), (e) => e.code === CHECK);
            await assert.rejects(() => item(ids.cuota, insc), (e) => e.code === CHECK);
            await assert.rejects(() => item(ids.cuota, null, 0), (e) => e.code === CHECK);
            await item(ids.cuota, null);
            await item(null, insc);
            const r = await db.query('SELECT COUNT(*) AS n FROM factura_items WHERE factura_id = $1', [factura]);
            assert.equal(r.rows[0].n, 2);
        });
    });

    describe('comprobantes de pago (relación 1:N con la factura)', () => {
        it('una factura admite varios comprobantes', async () => {
            const factura = await nuevaFactura();
            await nuevoComprobante(factura);
            await nuevoComprobante(factura);
            await nuevoComprobante(factura, undefined, 'application/pdf');
            const r = await db.query('SELECT COUNT(*) AS n FROM comprobantes_pago WHERE factura_id = $1', [factura]);
            assert.equal(r.rows[0].n, 3);
        });
        it('solo acepta PNG, JPG o PDF', async () => {
            const factura = await nuevaFactura();
            await assert.rejects(() => nuevoComprobante(factura, undefined, 'application/zip'), (e) => e.code === CHECK);
            await assert.rejects(() => nuevoComprobante(factura, undefined, 'image/gif'), (e) => e.code === CHECK);
            await nuevoComprobante(factura, undefined, 'image/jpeg');
        });
        it('rechaza facturas inexistentes, rutas repetidas y tamaños no positivos', async () => {
            await assert.rejects(() => nuevoComprobante(2147483000), (e) => e.code === FK);
            const factura = await nuevaFactura();
            const ruta = unico('comprobantes/repetida');
            await nuevoComprobante(factura, ruta);
            await assert.rejects(() => nuevoComprobante(factura, ruta), (e) => e.code === UNICO);
            await rechaza(
                `INSERT INTO comprobantes_pago (factura_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, subido_por)
                 VALUES ($1, 'x', $2, 'image/png', 0, $3)`, [factura, unico('ruta'), ids.tutor], CHECK);
        });
        it('al borrar una factura se borran sus comprobantes e ítems', async () => {
            const factura = await nuevaFactura();
            await nuevoComprobante(factura);
            await db.query('DELETE FROM facturas WHERE id = $1', [factura]);
            const r = await db.query('SELECT COUNT(*) AS n FROM comprobantes_pago WHERE factura_id = $1', [factura]);
            assert.equal(r.rows[0].n, 0);
        });
    });
});
