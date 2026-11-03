// Revisión de las facturas por la Dirección (HU9): ver las que están en revisión con sus comprobantes y darlas por
// pagadas o rechazarlas con un motivo. Solo el administrador.
// Al aprobar una factura, cada cuota que incluye queda registrada como pago (atado a la factura) y descuenta del saldo
// de la familia, igual que un pago cargado a mano: así los reportes de ingresos y el estado de cuenta la reflejan.
const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');
const { ReglaError } = require('../utils/inscripciones');
const { ESTADOS, validarRevision, validarRango, fechaLocalSql, aCentavosFactura, cobraDeMas } = require('../utils/facturas');
const { AlmacenError, obtenerAlmacen } = require('../services/almacenamiento');

const SEGUNDOS_ENLACE = 600;

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    if (err instanceof AlmacenError) return res.status(502).json({ message: 'No se pudo completar la operación con el almacenamiento. Reintentá en unos segundos.' });
    responderErrorInterno(res, err);
};

// GET /api/facturas?estado=En revision&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
// Las que esperan revisión van primero.
exports.listar = async (req, res) => {
    try {
        const estado = req.query.estado || null;
        if (estado && !ESTADOS.includes(estado)) throw new ReglaError(400, `Estado inválido. Usá: ${ESTADOS.join(', ')}`);
        const rango = validarRango({ desde: req.query.desde, hasta: req.query.hasta });
        if (rango.error) throw new ReglaError(400, rango.error);
        const facturas = (await db.query(
            `SELECT f.id, f.referencia, f.total, f.estado, f.emitida_en, f.pagada_en, f.revisada_en, u.nombre AS padre,
                    (SELECT COUNT(*) FROM factura_items fi WHERE fi.factura_id = f.id)::int AS cantidad_items,
                    (SELECT COUNT(*) FROM comprobantes_pago c WHERE c.factura_id = f.id)::int AS cantidad_comprobantes
             FROM facturas f JOIN users u ON u.id = f.tutor_id
             WHERE ($1::text IS NULL OR f.estado = $1)
               AND ($2::date IS NULL OR ${fechaLocalSql('f.emitida_en')} >= $2::date) AND ($3::date IS NULL OR ${fechaLocalSql('f.emitida_en')} <= $3::date)
             ORDER BY CASE f.estado WHEN 'En revision' THEN 0 ELSE 1 END, f.emitida_en DESC, f.id DESC`,
            [estado, rango.desde, rango.hasta]
        )).rows;
        res.json({ facturas });
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/facturas/:id: la factura con sus ítems y los comprobantes que adjuntó la familia
exports.detalle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Factura inválida' });
    try {
        const factura = (await db.query(
            `SELECT f.id, f.referencia, f.total, f.estado, f.emitida_en, f.pagada_en, f.motivo_rechazo, f.revisada_en,
                    u.nombre AS padre, u.username AS padre_usuario, r.nombre AS revisada_por
             FROM facturas f JOIN users u ON u.id = f.tutor_id LEFT JOIN users r ON r.id = f.revisada_por WHERE f.id = $1`, [id]
        )).rows[0];
        if (!factura) throw new ReglaError(404, 'Factura no encontrada');
        const [items, comprobantes] = await Promise.all([
            db.query(
                `SELECT fi.id, a.apellido || ', ' || a.nombre AS alumno, fi.descripcion, fi.monto
                 FROM factura_items fi JOIN alumnos a ON a.id = fi.alumno_id WHERE fi.factura_id = $1 ORDER BY fi.id`, [id]
            ),
            db.query('SELECT id, nombre_archivo, tipo_mime, tamano_bytes, subido_en FROM comprobantes_pago WHERE factura_id = $1 ORDER BY subido_en, id', [id]),
        ]);
        res.json({ ...factura, items: items.rows, comprobantes: comprobantes.rows });
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/facturas/comprobantes/:id/url: enlace temporal para ver un comprobante (el bucket es privado)
exports.urlComprobante = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Comprobante inválido' });
    try {
        const almacen = obtenerAlmacen();
        if (!almacen) throw new ReglaError(503, 'El almacenamiento de comprobantes todavía no está configurado');
        const comprobante = (await db.query('SELECT ruta_storage FROM comprobantes_pago WHERE id = $1', [id])).rows[0];
        if (!comprobante) throw new ReglaError(404, 'Comprobante no encontrado');
        res.json({ url: await almacen.urlFirmada(comprobante.ruta_storage, SEGUNDOS_ENLACE), vence_en_segundos: SEGUNDOS_ENLACE });
    } catch (err) {
        responderError(res, err);
    }
};

// PATCH /api/facturas/:id/estado  { estado: 'Pagada' | 'Rechazada', motivo }
exports.cambiarEstado = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Factura inválida' });
    let cliente;
    try {
        cliente = await db.getClient();
        await cliente.query('BEGIN');
        const actual = (await cliente.query('SELECT id, estado FROM facturas WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!actual) throw new ReglaError(404, 'Factura no encontrada');
        const revision = validarRevision(req.body, actual.estado);
        if (revision.error) throw new ReglaError(revision.codigo, revision.error);

        if (revision.estado === 'Pagada') {
            const cuotas = (await cliente.query(
                `SELECT fi.alumno_id, fi.cuota_id, fi.monto, fi.descripcion, cc.monto AS cuota_monto,
                        COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.alumno_id = fi.alumno_id AND p.cuota_id = fi.cuota_id), 0) AS pagado
                 FROM factura_items fi JOIN cuotas_config cc ON cc.id = fi.cuota_id
                 WHERE fi.factura_id = $1 AND fi.cuota_id IS NOT NULL ORDER BY fi.id`, [id])).rows;
            // Si la Dirección cobró en mano una cuota después de emitida la factura, aprobarla la cobraría dos veces
            const repetida = cuotas.find(cobraDeMas);
            if (repetida) throw new ReglaError(409, `${repetida.descripcion}: la cuota ya recibió pagos y esta factura la cobraría de más. Rechazala indicando el motivo y la familia genera otra con lo que falta.`);
            const porAlumno = new Map();
            for (const c of cuotas) {
                await cliente.query(
                    `INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago, factura_id) VALUES ($1, $2, $3, 'Transferencia', $4)`,
                    [c.alumno_id, c.cuota_id, c.monto, id]
                );
                porAlumno.set(c.alumno_id, (porAlumno.get(c.alumno_id) || 0) + aCentavosFactura(c.monto));
            }
            for (const [alumnoId, centavos] of porAlumno) {
                await cliente.query(
                    `INSERT INTO saldos_alumnos (alumno_id, saldo_pendiente) VALUES ($1, -$2::numeric)
                     ON CONFLICT (alumno_id) DO UPDATE SET saldo_pendiente = saldos_alumnos.saldo_pendiente - $2::numeric, ultima_actualizacion = CURRENT_TIMESTAMP`,
                    [alumnoId, centavos / 100]
                );
            }
        }

        const factura = (await cliente.query(
            `UPDATE facturas SET estado = $2, motivo_rechazo = $3, revisada_por = $4, revisada_en = CURRENT_TIMESTAMP,
                    pagada_en = CASE WHEN $2 = 'Pagada' THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE id = $1 RETURNING id, referencia, total, estado, emitida_en, pagada_en, motivo_rechazo, revisada_en`,
            [id, revision.estado, revision.motivo, req.user.id]
        )).rows[0];
        await cliente.query('COMMIT');
        res.json({ message: revision.estado === 'Pagada' ? 'Factura dada por pagada' : 'Factura rechazada', factura });
    } catch (err) {
        if (cliente) await cliente.query('ROLLBACK').catch(() => {});
        responderError(res, err);
    } finally {
        if (cliente) cliente.release();
    }
};
