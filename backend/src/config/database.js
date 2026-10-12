const { Pool, types } = require('pg');
const fs = require('fs');
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
    try {
        await pool.query(schema);
        console.log('Conectado a PostgreSQL (Supabase) y esquema verificado.');
    } catch (err) {
        console.error('Error al inicializar el esquema de la base de datos:', err.message);
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
