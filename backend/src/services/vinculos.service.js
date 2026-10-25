// Consultas compartidas sobre el vínculo cuenta ↔ legajo (alumnos.user_id y personal.user_id).
const db = require('../config/database');

// Id del legajo docente (personal) asociado a la cuenta, o null si la cuenta todavía no está vinculada.
async function docenteDeCuenta(userId) {
    const r = await db.query("SELECT id FROM personal WHERE user_id = $1 AND tipo = 'Docente'", [userId]);
    return r.rows[0] ? r.rows[0].id : null;
}

// Id del legajo de alumno asociado a la cuenta, o null si la cuenta todavía no está vinculada.
async function alumnoDeCuenta(userId) {
    const r = await db.query('SELECT id FROM alumnos WHERE user_id = $1', [userId]);
    return r.rows[0] ? r.rows[0].id : null;
}

module.exports = { docenteDeCuenta, alumnoDeCuenta };
