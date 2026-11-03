// Historial de deudas y comprobante consolidado en PDF (HU9). Solo el padre/tutor, y solo lo suyo.
//  - El historial lista las facturas de un rango de fechas con su desglose por ítem, más los pagos que la institución
//    registró por su cuenta, y un resumen de totales.
//  - El PDF no se puede pedir con el encabezado de sesión desde un navegador o un visor: la app pide un enlace
//    temporal firmado (5 minutos) y lo abre. El token solo sirve para ese PDF y no es un token de sesión.
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { validarRango, resumenFacturas, fechaLocalSql } = require('../utils/facturas');
const { dibujarFactura, dibujarHistorial } = require('../services/facturasPdf');

const SEGUNDOS_PDF = 300;
// Otro secreto distinto del de la sesión: un token de PDF jamás puede usarse como token de sesión
const secretoPdf = () => `${process.env.JWT_SECRET}:pdf`;

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    res.status(500).json({ message: err.message });
};

// Los timestamps de la base están en UTC y el rango se entiende en hora de Argentina
const FECHA_LOCAL = fechaLocalSql;

const leerRango = (consulta) => {
    const rango = validarRango({ desde: consulta.desde, hasta: consulta.hasta });
    if (rango.error) throw new ReglaError(400, rango.error);
    return rango;
};

const nombreDelPadre = async (padreId) => (await db.query('SELECT nombre FROM users WHERE id = $1', [padreId])).rows[0]?.nombre || '';

async function itemsDe(facturas) {
    if (!facturas.length) return [];
    return (await db.query(
        `SELECT fi.factura_id, fi.alumno_id, a.apellido || ', ' || a.nombre AS alumno, fi.descripcion, fi.monto
         FROM factura_items fi JOIN alumnos a ON a.id = fi.alumno_id
         WHERE fi.factura_id = ANY($1) ORDER BY fi.id`, [facturas.map((f) => f.id)]
    )).rows;
}

async function datosHistorial(padreId, { desde, hasta }) {
    const facturas = (await db.query(
        `SELECT f.id, f.referencia, f.total, f.estado, f.emitida_en, f.pagada_en, f.motivo_rechazo
         FROM facturas f
         WHERE f.tutor_id = $1 AND ($2::date IS NULL OR ${FECHA_LOCAL('f.emitida_en')} >= $2::date) AND ($3::date IS NULL OR ${FECHA_LOCAL('f.emitida_en')} <= $3::date)
         ORDER BY f.emitida_en DESC, f.id DESC`, [padreId, desde, hasta]
    )).rows;
    const items = await itemsDe(facturas);
    // Pagos que registró la institución por su cuenta; los que salieron de aprobar una factura ya figuran en ella
    const otrosPagos = (await db.query(
        `SELECT p.id, a.apellido || ', ' || a.nombre AS alumno, p.monto_pagado AS monto, p.fecha_pago, p.metodo_pago, cc.mes AS cuota_mes, cc.anio AS cuota_anio
         FROM pagos p JOIN alumnos a ON a.id = p.alumno_id LEFT JOIN cuotas_config cc ON cc.id = p.cuota_id
         WHERE a.tutor_id = $1 AND p.factura_id IS NULL
           AND ($2::date IS NULL OR ${FECHA_LOCAL('p.fecha_pago')} >= $2::date) AND ($3::date IS NULL OR ${FECHA_LOCAL('p.fecha_pago')} <= $3::date)
         ORDER BY p.fecha_pago DESC, p.id DESC`, [padreId, desde, hasta]
    )).rows;
    const conItems = facturas.map((f) => ({ ...f, items: items.filter((i) => i.factura_id === f.id) }));
    return { desde, hasta, facturas: conItems, otros_pagos: otrosPagos, resumen: resumenFacturas(conItems) };
}

// GET /api/cuentas/historial?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
exports.getHistorial = async (req, res) => {
    try {
        res.json(await datosHistorial(req.user.id, leerRango(req.query)));
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/cuentas/pdf-enlace?tipo=factura&id=N   o   ?tipo=historial&desde=...&hasta=...
exports.pedirEnlacePdf = async (req, res) => {
    try {
        const { tipo } = req.query;
        const reclamos = { pdf: true, uid: req.user.id, tipo };
        if (tipo === 'factura') {
            const id = parseInt(req.query.id);
            if (!id) throw new ReglaError(400, 'Factura inválida');
            const factura = (await db.query('SELECT tutor_id FROM facturas WHERE id = $1', [id])).rows[0];
            if (!factura) throw new ReglaError(404, 'Factura no encontrada');
            if (factura.tutor_id !== req.user.id) throw new ReglaError(403, 'No tenés acceso a esta factura');
            reclamos.fid = id;
        } else if (tipo === 'historial') {
            const { desde, hasta } = leerRango(req.query);
            reclamos.desde = desde;
            reclamos.hasta = hasta;
        } else {
            throw new ReglaError(400, 'Tipo de PDF inválido. Usá: factura o historial');
        }
        const token = jwt.sign(reclamos, secretoPdf(), { expiresIn: SEGUNDOS_PDF });
        res.json({ ruta: `/api/cuentas/pdf/${token}`, vence_en_segundos: SEGUNDOS_PDF });
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/cuentas/pdf/:token (sin sesión: la autorización es el token firmado)
exports.servirPdf = async (req, res) => {
    let datos;
    try {
        datos = jwt.verify(req.params.token, secretoPdf());
    } catch {
        return res.status(401).json({ message: 'El enlace del PDF venció o no es válido. Pedí uno nuevo desde la app.' });
    }
    if (!datos.pdf) return res.status(401).json({ message: 'El enlace del PDF no es válido' });

    try {
        const padre = await nombreDelPadre(datos.uid);
        if (datos.tipo === 'factura') {
            const factura = (await db.query(
                'SELECT id, tutor_id, referencia, total, estado, emitida_en, pagada_en, motivo_rechazo FROM facturas WHERE id = $1', [datos.fid]
            )).rows[0];
            if (!factura || factura.tutor_id !== datos.uid) throw new ReglaError(404, 'Factura no encontrada');
            const items = await itemsDe([factura]);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="comprobante-${factura.referencia}.pdf"`);
            return dibujarFactura({ ...factura, padre, items }, res);
        }
        const historial = await datosHistorial(datos.uid, { desde: datos.desde || null, hasta: datos.hasta || null });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="historial-de-pagos.pdf"');
        dibujarHistorial({ padre, desde: historial.desde, hasta: historial.hasta, facturas: historial.facturas, otrosPagos: historial.otros_pagos, resumen: historial.resumen }, res);
    } catch (err) {
        responderError(res, err);
    }
};

exports.datosHistorial = datosHistorial;
