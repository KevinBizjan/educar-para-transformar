// Vínculo entre las cuentas de usuario y los legajos (ARTE-2, Sprint C). Solo para el administrador.
//
// Una cuenta con rol docente o alumno se asocia a su legajo (personal / alumnos) para que cada persona vea
// solo lo suyo. El vínculo es opcional y uno a uno: una cuenta, una persona.
const db = require('../config/database');
const { leerUserId, validarRolDeCuenta } = require('../utils/vinculos');
const { legajoAlumnoSql, legajoDocenteSql } = require('../utils/reportes');

// Tablas permitidas (nunca se arma el nombre de la tabla con datos del pedido).
const LEGAJOS = {
    alumno: { tabla: 'alumnos', filtro: '', etiqueta: 'un alumno' },
    docente: { tabla: 'personal', filtro: " AND tipo = 'Docente'", etiqueta: 'un docente' },
};

// Alumnos, docentes y cuentas que todavía no pertenecen a nadie (para elegir a quién vincular).
exports.listar = async (req, res) => {
    try {
        const [alumnos, docentes, cuentas] = await Promise.all([
            db.query(
                `SELECT a.id, ${legajoAlumnoSql('a.id')} AS legajo, a.apellido, a.nombre, a.estado, a.user_id, u.username
                 FROM alumnos a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.apellido, a.nombre`
            ),
            db.query(
                `SELECT p.id, ${legajoDocenteSql('p.id')} AS legajo, p.apellido, p.nombre, p.estado, p.user_id, u.username
                 FROM personal p LEFT JOIN users u ON u.id = p.user_id WHERE p.tipo = 'Docente' ORDER BY p.apellido, p.nombre`
            ),
            db.query(
                `SELECT u.id, u.username, u.nombre, u.rol FROM users u
                 WHERE u.rol IN ('alumno', 'docente')
                   AND NOT EXISTS (SELECT 1 FROM alumnos a WHERE a.user_id = u.id)
                   AND NOT EXISTS (SELECT 1 FROM personal p WHERE p.user_id = u.id)
                 ORDER BY u.rol, u.username`
            ),
        ]);
        res.json({ alumnos: alumnos.rows, docentes: docentes.rows, cuentas_libres: cuentas.rows });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Vincula (o desvincula, con user_id null) una cuenta a un legajo del tipo indicado.
const vincular = (tipo) => async (req, res) => {
    const { tabla, filtro, etiqueta } = LEGAJOS[tipo];
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Legajo inválido' });
    const userId = leerUserId(req.body.user_id);
    if (userId === undefined) return res.status(400).json({ message: 'La cuenta indicada no es válida' });

    try {
        const legajo = (await db.query(`SELECT id FROM ${tabla} WHERE id = $1${filtro}`, [id])).rows[0];
        if (!legajo) return res.status(404).json({ message: 'Legajo no encontrado' });

        let username = null;
        if (userId !== null) {
            const cuenta = (await db.query('SELECT id, username, rol FROM users WHERE id = $1', [userId])).rows[0];
            if (!cuenta) return res.status(404).json({ message: 'La cuenta no existe' });
            const errorRol = validarRolDeCuenta(tipo, cuenta.rol);
            if (errorRol) return res.status(400).json({ message: errorRol });
            const ocupada = (await db.query(`SELECT id FROM ${tabla} WHERE user_id = $1 AND id <> $2`, [userId, id])).rows[0];
            if (ocupada) return res.status(409).json({ message: `Esa cuenta ya está vinculada a otro legajo. Desvinculala primero para asignarla a ${etiqueta} distinto.` });
            username = cuenta.username;
        }

        await db.query(`UPDATE ${tabla} SET user_id = $1 WHERE id = $2`, [userId, id]);
        res.json({ id, user_id: userId, username });
    } catch (err) {
        // El índice único cubre la carrera entre dos pedidos simultáneos con la misma cuenta.
        if (err.code === '23505') return res.status(409).json({ message: 'Esa cuenta ya está vinculada a otro legajo.' });
        res.status(500).json({ message: err.message });
    }
};

exports.vincularAlumno = vincular('alumno');
exports.vincularDocente = vincular('docente');
