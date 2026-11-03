// Correos automáticos (HU10): ejecutar el envío del día y consultar la auditoría.
//  - POST /api/correos/ejecutar: lo llama el disparador diario (con el secreto CRON_SECRET) o un administrador, que además
//    puede simular, elegir los envíos y cambiar la fecha para probar.
//  - GET /api/correos: auditoría de cada correo (solo administrador).
const crypto = require('crypto');
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { esFecha } = require('../utils/facturas');
const { TIPOS } = require('../utils/correos');
const job = require('../services/correosJob'); // se llama como job.ejecutarTareas para poder reemplazarlo en las pruebas

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    res.status(500).json({ message: err.message });
};

// Comparación del secreto en tiempo constante (no revela cuántos caracteres coinciden)
const secretoValido = (enviado) => {
    const esperado = process.env.CRON_SECRET || '';
    if (!esperado || typeof enviado !== 'string') return false;
    const a = crypto.createHash('sha256').update(enviado).digest();
    const b = crypto.createHash('sha256').update(esperado).digest();
    return crypto.timingSafeEqual(a, b);
};
exports.secretoValido = secretoValido;

exports.ejecutar = async (req, res) => {
    try {
        // El disparador diario no puede cambiar nada: corre lo que corresponde hoy. Solo el administrador elige.
        const opciones = {};
        if (!req.cron) {
            const { fecha, tipos, simular, padres } = req.body || {};
            if (fecha !== undefined) {
                if (!esFecha(fecha)) throw new ReglaError(400, 'La fecha no es válida (usá AAAA-MM-DD)');
                opciones.hoy = fecha;
            }
            if (tipos !== undefined) {
                if (!Array.isArray(tipos) || tipos.some((t) => !TIPOS.includes(t))) throw new ReglaError(400, `Tipos inválidos. Usá: ${TIPOS.join(', ')}`);
                opciones.tipos = tipos;
            }
            if (padres !== undefined) {
                if (!Array.isArray(padres) || padres.length === 0 || padres.some((p) => !Number.isInteger(p) || p <= 0)) throw new ReglaError(400, 'Padres inválidos: indicá una lista de ids de cuentas');
                opciones.padreIds = padres;
            }
            opciones.simular = simular === true;
        }
        res.json(await job.ejecutarTareas(opciones));
    } catch (err) {
        responderError(res, err);
    }
};

exports.listar = async (req, res) => {
    try {
        const { tipo, estado } = req.query;
        if (tipo && !TIPOS.includes(tipo)) throw new ReglaError(400, `Tipo inválido. Usá: ${TIPOS.join(', ')}`);
        if (estado && !['Enviado', 'Error', 'Omitido'].includes(estado)) throw new ReglaError(400, 'Estado inválido. Usá: Enviado, Error u Omitido');
        const limite = Math.min(Math.max(parseInt(req.query.limite) || 100, 1), 500);
        const correos = (await db.query(
            `SELECT c.id, c.tipo, c.periodo, c.destinatario, u.nombre AS familia, c.asunto, c.estado, c.detalle, c.proveedor_id, c.factura_id, f.referencia AS factura, c.creado_en
             FROM correos_enviados c LEFT JOIN users u ON u.id = c.usuario_id LEFT JOIN facturas f ON f.id = c.factura_id
             WHERE ($1::text IS NULL OR c.tipo = $1) AND ($2::text IS NULL OR c.estado = $2)
             ORDER BY c.id DESC LIMIT $3`, [tipo || null, estado || null, limite]
        )).rows;
        res.json({ correos });
    } catch (err) {
        responderError(res, err);
    }
};
