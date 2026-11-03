// El esquema se aplica una sola vez por cambio de schema.sql (y con un bloqueo, para que varios procesos que arrancan a la vez
// no se pisen). Solo corre contra un PostgreSQL local.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost).';

describe('Esquema de la base: aplicación única', { skip }, () => {
    let db;
    before(async () => {
        db = require('../src/config/database');
        await db.ready;
    });
    after(async () => { if (db) await db.end(); });

    it('guarda la huella del schema.sql aplicado', async () => {
        const esquema = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');
        const huella = crypto.createHash('sha256').update(esquema).digest('hex');
        const filas = (await db.query('SELECT huella FROM schema_version')).rows;
        assert.deepEqual(filas, [{ huella }], 'una sola fila, con la huella del archivo actual');
    });

    it('las tablas e índices de las historias recientes existen', async () => {
        const tablas = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((t) => t.table_name);
        for (const t of ['facturas', 'factura_items', 'comprobantes_pago', 'correos_enviados', 'schema_version']) assert.ok(tablas.includes(t), t);
        const indices = (await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map((i) => i.indexname);
        for (const i of ['correos_una_vez_por_periodo', 'pagos_alumno_cuota_idx', 'factura_items_inscripcion_idx']) assert.ok(indices.includes(i), i);
    });
});
