// Historial de deudas y comprobante consolidado en PDF (HU9). Solo el padre/tutor, y solo lo suyo.
//  - El historial lista las facturas de un rango de fechas con su desglose por ítem y sus comprobantes, más los pagos
//    que la institución registró por su cuenta, y un resumen de totales. Se puede acotar a un hijo (alumno_id): entonces
//    solo figuran las facturas que lo incluyen, con sus ítems y su parte del total.
//  - El PDF no se puede pedir con el encabezado de sesión desde un navegador o un visor: la app pide un enlace
//    temporal firmado (5 minutos) y lo abre. El token solo sirve para ese PDF y no es un token de sesión.
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');
const { ReglaError } = require('../utils/inscripciones');
const { validarRango, resumenFacturas, fechaLocalSql, totalFactura } = require('../utils/facturas');
const { dibujarFactura, dibujarHistorial } = require('../services/facturasPdf');

const SEGUNDOS_PDF = 300;
// Otro secreto distinto del de la sesión: un token de PDF jamás puede usarse como token de sesión
const secretoPdf = () => `${process.env.JWT_SECRET}:pdf`;

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    responderErrorInterno(res, err);
};

// Los timestamps de la base están en UTC y el rango se entiende en hora de Argentina
const FECHA_LOCAL = fechaLocalSql;

const leerRango = (consulta) => {
    const rango = validarRango({ desde: consulta.desde, hasta: consulta.hasta });
    if (rango.error) throw new ReglaError(400, rango.error);
    return rango;
};

// alumno_id opcional: debe ser un entero y un hijo del padre (si no, 400 o 403)
const leerAlumno = async (consulta, padreId) => {
    if (consulta.alumno_id === undefined || consulta.alumno_id === '') return null;
    const id = Number(consulta.alumno_id);
    if (!Number.isInteger(id) || id <= 0) throw new ReglaError(400, 'Alumno inválido');
    const alumno = (await db.query('SELECT tutor_id FROM alumnos WHERE id = $1', [id])).rows[0];
    if (!alumno) throw new ReglaError(404, 'Alumno no encontrado');
    if (alumno.tutor_id !== padreId) throw new ReglaError(403, 'Solo podés consultar a tus propios hijos');
    return id;
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

// Comprobantes de transferencia de cada factura (sin la ruta interna de Storage: el archivo se ve con un enlace temporal)
async function comprobantesDe(facturas) {
    if (!facturas.length) return [];
    return (await db.query(
        `SELECT id, factura_id, nombre_archivo, tipo_mime, tamano_bytes, subido_en
         FROM comprobantes_pago WHERE factura_id = ANY($1) ORDER BY subido_en, id`, [facturas.map((f) => f.id)]
    )).rows;
}

async function datosHistorial(padreId, { desde, hasta }, alumnoId = null) {
    const todas = (await db.query(
        `SELECT f.id, f.referencia, f.total, f.estado, f.emitida_en, f.pagada_en, f.motivo_rechazo
         FROM facturas f
         WHERE f.tutor_id = $1 AND ($2::date IS NULL OR ${FECHA_LOCAL('f.emitida_en')} >= $2::date) AND ($3::date IS NULL OR ${FECHA_LOCAL('f.emitida_en')} <= $3::date)
         ORDER BY f.emitida_en DESC, f.id DESC`, [padreId, desde, hasta]
    )).rows;
    let items = await itemsDe(todas);
    let facturas = todas;
    if (alumnoId) {
        // Solo las facturas que incluyen al hijo, con sus renglones y la parte del total que le corresponde
        items = items.filter((i) => i.alumno_id === alumnoId);
        facturas = todas.filter((f) => items.some((i) => i.factura_id === f.id)).map((f) => ({
            ...f, total_factura: f.total, total: totalFactura(items.filter((i) => i.factura_id === f.id)),
        }));
    }
    const comprobantes = await comprobantesDe(facturas);
    // Pagos que registró la institución por su cuenta; los que salieron de aprobar una factura ya figuran en ella
    const otrosPagos = (await db.query(
        `SELECT p.id, a.apellido || ', ' || a.nombre AS alumno, p.monto_pagado AS monto, p.fecha_pago, p.metodo_pago, cc.mes AS cuota_mes, cc.anio AS cuota_anio
         FROM pagos p JOIN alumnos a ON a.id = p.alumno_id LEFT JOIN cuotas_config cc ON cc.id = p.cuota_id
         WHERE a.tutor_id = $1 AND p.factura_id IS NULL AND ($4::int IS NULL OR p.alumno_id = $4::int)
           AND ($2::date IS NULL OR ${FECHA_LOCAL('p.fecha_pago')} >= $2::date) AND ($3::date IS NULL OR ${FECHA_LOCAL('p.fecha_pago')} <= $3::date)
         ORDER BY p.fecha_pago DESC, p.id DESC`, [padreId, desde, hasta, alumnoId]
    )).rows;
    const conItems = facturas.map((f) => ({
        ...f, items: items.filter((i) => i.factura_id === f.id), comprobantes: comprobantes.filter((c) => c.factura_id === f.id),
    }));
    return { desde, hasta, alumno_id: alumnoId, facturas: conItems, otros_pagos: otrosPagos, resumen: resumenFacturas(conItems) };
}

// GET /api/cuentas/historial?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&alumno_id=N
exports.getHistorial = async (req, res) => {
    try {
        const rango = leerRango(req.query);
        res.json(await datosHistorial(req.user.id, rango, await leerAlumno(req.query, req.user.id)));
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/cuentas/pdf-enlace?tipo=factura&id=N   o   ?tipo=historial&desde=...&hasta=...&alumno_id=N
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
            reclamos.aid = await leerAlumno(req.query, req.user.id);
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
        const historial = await datosHistorial(datos.uid, { desde: datos.desde || null, hasta: datos.hasta || null }, datos.aid || null);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="historial-de-pagos.pdf"');
        dibujarHistorial({ padre, desde: historial.desde, hasta: historial.hasta, facturas: historial.facturas, otrosPagos: historial.otros_pagos, resumen: historial.resumen }, res);
    } catch (err) {
        responderError(res, err);
    }
};

exports.datosHistorial = datosHistorial;
