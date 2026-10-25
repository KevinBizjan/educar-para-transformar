const db = require('../config/database');
const { MAX_RECORRIDOS } = require('../utils/deportes');

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- COMEDOR ---
exports.registrarAsistenciaComedor = async (req, res) => {
    const { alumno_id, consumio_menu, observaciones } = req.body;
    if (!alumno_id) return res.status(400).json({ message: 'Debe indicar el alumno' });

    try {
        const result = await db.query(
            'INSERT INTO comedor_asistencias (alumno_id, consumio_menu, observaciones) VALUES ($1, $2, $3) RETURNING id',
            [alumno_id, consumio_menu, observaciones]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- TRANSPORTE ---
exports.getRutasTransporte = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM transporte_rutas');
        res.json(result.rows.map(r => ({
            id: r.id,
            nombre: r.nombre_ruta,
            chofer: r.chofer_nombre,
            capacidad: r.capacidad_max
        })));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createRutaTransporte = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    const { chofer } = req.body;
    const capacidad = Number(req.body.capacidad);
    if (!nombre || !Number.isInteger(capacidad) || capacidad <= 0) {
        return res.status(400).json({ message: 'El nombre de la ruta y una capacidad entera mayor a 0 son obligatorios' });
    }

    try {
        // El servicio de transporte tiene cuatro recorridos.
        const { n } = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_rutas')).rows[0];
        if (n >= MAX_RECORRIDOS) {
            return res.status(409).json({ message: `El servicio de transporte tiene como máximo ${MAX_RECORRIDOS} recorridos` });
        }
        const result = await db.query(
            'INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, $2, $3) RETURNING id',
            [nombre, chofer, capacidad]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.asignarAlumnoTransporte = async (req, res) => {
    const { alumno_id, ruta_id, punto_encuentro } = req.body;
    if (!alumno_id || !ruta_id) return res.status(400).json({ message: 'Debe indicar el alumno y la ruta' });

    try {
        const result = await db.query(
            'INSERT INTO transporte_asignaciones (alumno_id, ruta_id, punto_encuentro) VALUES ($1, $2, $3) RETURNING id',
            [alumno_id, ruta_id, punto_encuentro]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteRutaTransporte = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM transporte_rutas WHERE id = $1', [id]);
        res.json({ message: 'Ruta eliminada' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- INSTALACIONES ---
exports.getInstalaciones = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM instalaciones');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.reservarInstalacion = async (req, res) => {
    const { instalacion_id, fecha, reservado_por, motivo } = req.body;
    const hora_inicio = (req.body.hora_inicio || '').trim();
    const hora_fin = (req.body.hora_fin || '').trim();

    if (!instalacion_id || !fecha || !hora_inicio || !hora_fin) {
        return res.status(400).json({ message: 'Instalación, fecha, hora de inicio y hora de fin son obligatorios' });
    }
    if (!HORA_REGEX.test(hora_inicio) || !HORA_REGEX.test(hora_fin)) {
        return res.status(400).json({ message: 'Las horas deben tener formato HH:MM (24h)' });
    }
    if (hora_inicio >= hora_fin) {
        return res.status(400).json({ message: 'La hora de inicio debe ser anterior a la hora de fin' });
    }

    try {
        // Validar disponibilidad
        const checkQuery = `
            SELECT COUNT(*) as count FROM instalaciones_reservas
            WHERE instalacion_id = $1 AND fecha = $2
            AND hora_inicio < $3 AND hora_fin > $4
        `;
        const checkResult = await db.query(checkQuery, [instalacion_id, fecha, hora_fin, hora_inicio]);
        if (checkResult.rows[0].count > 0) {
            return res.status(400).json({ message: 'La instalación ya está reservada en ese horario.' });
        }

        const result = await db.query(
            'INSERT INTO instalaciones_reservas (instalacion_id, fecha, hora_inicio, hora_fin, reservado_por, motivo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [instalacion_id, fecha, hora_inicio, hora_fin, reservado_por, motivo]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ENFERMERÍA ---
exports.registrarIncidenciaEnfermeria = async (req, res) => {
    const { alumno_id, accion_tomada, notificado_padre } = req.body;
    const descripcion = (req.body.descripcion || '').trim();
    if (descripcion.length < 10) {
        return res.status(400).json({ message: 'La descripción debe tener al menos 10 caracteres.' });
    }

    try {
        const result = await db.query(
            'INSERT INTO enfermeria_incidencias (alumno_id, descripcion, accion_tomada, notificado_padre) VALUES ($1, $2, $3, $4) RETURNING id',
            [alumno_id, descripcion, accion_tomada, notificado_padre]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
