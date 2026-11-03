const { Pool, types } = require('pg');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

// Por defecto pg-node devuelve NUMERIC/DECIMAL y BIGINT como strings (para no
// perder precisión) y DATE como objeto Date. SQLite devolvía todo esto como
// texto/número plano, y el frontend ya asume ese formato (ej. <input
// type="date" defaultValue={alumno.fecha_nacimiento}> necesita 'YYYY-MM-DD'
// exacto). Se ajustan los parsers para mantener el mismo comportamiento.
types.setTypeParser(1082, (val) => val); // DATE -> 'YYYY-MM-DD' (string, no Date)
types.setTypeParser(1700, (val) => parseFloat(val)); // NUMERIC/DECIMAL -> number
types.setTypeParser(20, (val) => parseInt(val, 10)); // BIGINT (ej. COUNT(*)) -> number

// Supabase exige SSL. DATABASE_SSL=false permite usar un PostgreSQL local o el
// de la integración continua (que no tiene SSL).
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err.message);
});

// Crea las tablas si no existen (schema.sql usa CREATE TABLE IF NOT EXISTS,
// por lo que es seguro ejecutarlo en cada arranque del servidor).
async function initializeDatabase() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    let cliente;
    try {
        cliente = await pool.connect();
        // Si varios procesos arrancan a la vez (las pruebas, o dos instancias en un despliegue), el bloqueo hace que apliquen
        // el esquema de a uno. Sin él, los ALTER TABLE de cada uno se pisan y PostgreSQL corta uno por "deadlock detected".
        await cliente.query('SELECT pg_advisory_lock(7000)');
        // El esquema solo se vuelve a aplicar si cambió schema.sql: sus ALTER TABLE e índices toman bloqueos sobre muchas tablas,
        // y repetirlos en cada arranque hacía chocar a un proceso que arranca con otro que ya está trabajando (deadlock).
        // SCHEMA_FORZAR=true lo aplica igual (por ejemplo, si alguien tocó la base a mano).
        const huella = crypto.createHash('sha256').update(schema).digest('hex');
        await cliente.query('CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY, huella TEXT NOT NULL, aplicado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        const aplicada = (await cliente.query('SELECT huella FROM schema_version WHERE id = 1')).rows[0];
        if (aplicada && aplicada.huella === huella && process.env.SCHEMA_FORZAR !== 'true') {
            console.log('Conectado a PostgreSQL (Supabase); el esquema ya estaba al día.');
        } else {
            await cliente.query(schema);
            await cliente.query(
                'INSERT INTO schema_version (id, huella) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET huella = $1, aplicado_en = CURRENT_TIMESTAMP', [huella]
            );
            console.log('Conectado a PostgreSQL (Supabase) y esquema verificado.');
        }
    } catch (err) {
        console.error('Error al inicializar el esquema de la base de datos:', err.message);
    } finally {
        if (cliente) {
            await cliente.query('SELECT pg_advisory_unlock(7000)').catch(() => {});
            cliente.release();
        }
    }
}

// Promesa que se resuelve cuando el esquema ya está aplicado; permite que el
// seed y las pruebas esperen en lugar de usar un retardo fijo.
const ready = initializeDatabase();

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    ready,
    end: () => pool.end()
};
