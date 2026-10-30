// Cuenta corriente de la familia en la app móvil (HU6 en adelante): cuotas e historial de pagos.
// Solo el padre/tutor, y solo de sus hijos.
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { FILTROS, hoyEnArgentina, armarCuota, filtrarCuotas, sumar, totalPendiente } = require('../utils/cuotas');

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    res.status(500).json({ message: err.message });
};

// Ids de los hijos del padre; si se pide uno en particular, tiene que ser suyo.
async function hijosDelPadre(padreId, alumnoId) {
    const filas = (await db.query('SELECT id FROM alumnos WHERE tutor_id = $1 ORDER BY id', [padreId])).rows.map((f) => f.id);
    if (alumnoId !== null && !filas.includes(alumnoId)) throw new ReglaError(403, 'No tenés acceso a este alumno');
    return alumnoId === null ? filas : [alumnoId];
}

// Cuotas del nivel de cada hijo ya emitidas (hasta el mes actual), con lo abonado y su estado.
async function cuotasDe(hijos, hoy) {
    if (!hijos.length) return [];
    const [anio, mes] = hoy.split('-').map(Number);
    const filas = (await db.query(
        `SELECT a.id AS alumno_id, a.nombre, a.apellido, cc.id AS cuota_id, cc.mes, cc.anio, cc.monto, cc.vencimiento,
                COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.alumno_id = a.id AND p.cuota_id = cc.id), 0) AS pagado,
                EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                        WHERE fi.alumno_id = a.id AND fi.cuota_id = cc.id AND f.estado = 'Pagada') AS facturada_pagada,
                EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                        WHERE fi.alumno_id = a.id AND fi.cuota_id = cc.id AND f.estado = 'En revision') AS en_revision
         FROM alumnos a
         JOIN cursos c ON c.id = a.curso_id
         JOIN cuotas_config cc ON cc.nivel_id = c.nivel_id AND (cc.anio < $2 OR (cc.anio = $2 AND cc.mes <= $3))
         WHERE a.id = ANY($1)
         ORDER BY cc.anio DESC, cc.mes DESC, a.apellido, a.nombre`,
        [hijos, anio, mes]
    )).rows;
    return filas.map((f) => armarCuota(f, hoy));
}

// GET /api/cuentas/cuotas?estado=pendientes|pagadas|historial[&alumno_id=n]
exports.getCuotas = async (req, res) => {
    const filtro = req.query.estado === undefined ? 'pendientes' : req.query.estado;
    if (!FILTROS.includes(filtro)) return res.status(400).json({ message: 'Filtro inválido. Usá: pendientes, pagadas o historial' });
    const alumnoId = req.query.alumno_id === undefined ? null : parseInt(req.query.alumno_id);
    if (alumnoId !== null && !alumnoId) return res.status(400).json({ message: 'Alumno inválido' });

    try {
        const hijos = await hijosDelPadre(req.user.id, alumnoId);

        if (filtro === 'historial') {
            const pagos = hijos.length ? (await db.query(
                `SELECT p.id, p.alumno_id, a.apellido || ', ' || a.nombre AS alumno, p.monto_pagado AS monto, p.fecha_pago,
                        p.metodo_pago, cc.mes AS cuota_mes, cc.anio AS cuota_anio
                 FROM pagos p
                 JOIN alumnos a ON a.id = p.alumno_id
                 LEFT JOIN cuotas_config cc ON cc.id = p.cuota_id
                 WHERE p.alumno_id = ANY($1)
                 ORDER BY p.fecha_pago DESC, p.id DESC`, [hijos]
            )).rows : [];
            return res.json({ filtro, pagos, total_pagado: sumar(pagos.map((p) => p.monto)) });
        }

        const todas = await cuotasDe(hijos, hoyEnArgentina());
        res.json({
            filtro,
            cuotas: filtrarCuotas(todas, filtro),
            total_pendiente: totalPendiente(todas),
            hay_deuda: todas.some((c) => c.estado !== 'Pagada'),
        });
    } catch (err) {
        responderError(res, err);
    }
};
