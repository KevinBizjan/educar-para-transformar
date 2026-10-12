const db = require('../config/database');
const { comunicados } = require('../patterns/comunicadosObserver');

// --- NOTIFICACIONES ---
exports.getNotificaciones = async (req, res) => {
    const { rol } = req.user;
    try {
        const result = await db.query(
            "SELECT * FROM notificaciones WHERE rol_destino = $1 OR rol_destino = 'all' ORDER BY fecha_envio DESC",
            [rol]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

const DESTINOS_VALIDOS = ['all', 'admin', 'docente', 'alumno', 'padre'];

exports.crearNotificacion = async (req, res) => {
    const titulo = (req.body.titulo || '').trim();
    const mensaje = (req.body.mensaje || '').trim();
    const rol_destino = (req.body.rol_destino || '').trim();

    if (!titulo || !mensaje || !rol_destino) {
        return res.status(400).json({ message: 'El título, el mensaje y el destinatario son obligatorios' });
    }
    if (!DESTINOS_VALIDOS.includes(rol_destino)) {
        return res.status(400).json({ message: 'Destinatario inválido' });
    }

    try {
        const result = await db.query(
            'INSERT INTO notificaciones (titulo, mensaje, rol_destino) VALUES ($1, $2, $3) RETURNING id',
            [titulo, mensaje, rol_destino]
        );
        const id = result.rows[0].id;
        // Patrón Observer: se avisa a quien esté suscripto (ver src/patterns/comunicadosObserver.js).
        comunicados.notificar({ id, titulo, mensaje, rol_destino });
        res.status(201).json({ id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ACTIVIDADES EXTRA ---
exports.getActividadesExtra = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM actividades_extra');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.inscribirActividad = async (req, res) => {
    const { alumno_id, actividad_id } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2) RETURNING id',
            [alumno_id, actividad_id]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
