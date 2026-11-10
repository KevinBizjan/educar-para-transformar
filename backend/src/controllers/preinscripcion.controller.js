const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');
const { NOMBRE_REGEX, esDniValido, esEmailValido, esEdadValida } = require('../utils/validators');

exports.create = async (req, res) => {
    const {
        alumno_nombre,
        alumno_dni,
        alumno_edad,
        nivel,
        turno,
        tutor_nombre,
        tutor_telefono,
        tutor_email,
        observaciones
    } = req.body;

    if (!alumno_nombre || !alumno_dni || !alumno_edad || !nivel || !turno || !tutor_nombre || !tutor_telefono || !tutor_email) {
        return res.status(400).json({ message: 'Todos los campos obligatorios deben ser completados' });
    }

    // Validaciones de formato y rango usando utilidades centralizadas
    if (!NOMBRE_REGEX.test(String(alumno_nombre).trim())) {
        return res.status(400).json({ message: 'El nombre del alumno solo puede contener letras (sin números ni símbolos)' });
    }
    if (!NOMBRE_REGEX.test(String(tutor_nombre).trim())) {
        return res.status(400).json({ message: 'El nombre del tutor solo puede contener letras (sin números ni símbolos)' });
    }
    if (!esDniValido(alumno_dni)) {
        return res.status(400).json({ message: 'El DNI debe ser numérico (sin puntos ni letras)' });
    }
    if (!esEdadValida(alumno_edad, 3, 18)) {
        return res.status(400).json({ message: 'La edad del alumno debe estar entre 3 y 18 años' });
    }
    if (!esEmailValido(tutor_email)) {
        return res.status(400).json({ message: 'El correo electrónico no tiene un formato válido' });
    }

    const query = `INSERT INTO preinscripciones
        (alumno_nombre, alumno_dni, alumno_edad, nivel, turno, tutor_nombre, tutor_telefono, tutor_email, observaciones)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`;

    try {
        const result = await db.query(query, [alumno_nombre, alumno_dni, alumno_edad, nivel, turno, tutor_nombre, tutor_telefono, tutor_email, observaciones]);
        res.status(201).json({ message: 'Preinscripción enviada con éxito', id: result.rows[0].id });
    } catch (err) {
        responderErrorInterno(res, err);
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM preinscripciones ORDER BY fecha DESC');
        res.json(result.rows);
    } catch (err) {
        responderErrorInterno(res, err);
    }
};

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    try {
        await db.query('UPDATE preinscripciones SET estado = $1 WHERE id = $2', [estado, id]);
        res.json({ message: 'Estado actualizado correctamente' });
    } catch (err) {
        res.status(500).json({ message: 'Error al actualizar el estado' });
    }
};
