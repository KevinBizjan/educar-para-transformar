const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');
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
        responderErrorInterno(res, err);
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
        responderErrorInterno(res, err);
    }
};

// --- ACTIVIDADES EXTRA ---
exports.getActividadesExtra = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM actividades_extra');
        res.json(result.rows);
    } catch (err) {
        responderErrorInterno(res, err);
    }
};
