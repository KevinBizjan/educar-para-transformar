// Comprobantes de transferencia de una factura (HU8): el padre adjunta uno o más archivos (PNG, JPG o PDF),
// que se guardan en Supabase Storage. Al adjuntar el primero, la factura pasa a "En revision".
const crypto = require('crypto');
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { MAX_POR_FACTURA, validarArchivo, rutaStorage } = require('../utils/comprobantes');
const { AlmacenError, obtenerAlmacen } = require('../services/almacenamiento');

const ESTADOS_QUE_ADMITEN = ['Pendiente', 'En revision'];
const SEGUNDOS_ENLACE = 600;

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    if (err instanceof AlmacenError) return res.status(502).json({ message: 'No se pudo completar la operación con el almacenamiento. Reintentá en unos segundos.' });
    res.status(500).json({ message: err.message });
};

const almacenOError = () => {
    const almacen = obtenerAlmacen();
    if (!almacen) throw new ReglaError(503, 'El almacenamiento de comprobantes todavía no está configurado');
    return almacen;
};

// La factura tiene que existir y ser del padre. `bloquear` toma la fila para decidir sin carreras.
async function facturaDelPadre(consulta, facturaId, padreId, bloquear = false) {
    const factura = (await consulta.query(`SELECT id, tutor_id, estado FROM facturas WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`, [facturaId])).rows[0];
    if (!factura) throw new ReglaError(404, 'Factura no encontrada');
    if (factura.tutor_id !== padreId) throw new ReglaError(403, 'No tenés acceso a esta factura');
    return factura;
}

const exigirAbierta = (factura) => {
    if (!ESTADOS_QUE_ADMITEN.includes(factura.estado)) {
        throw new ReglaError(409, `La factura está ${factura.estado === 'Pagada' ? 'pagada' : 'rechazada'}: ya no admite cambios en sus comprobantes`);
    }
};

const cantidadDe = async (consulta, facturaId) => (await consulta.query('SELECT COUNT(*)::int AS n FROM comprobantes_pago WHERE factura_id = $1', [facturaId])).rows[0].n;
const COLUMNAS = 'id, factura_id, nombre_archivo, tipo_mime, tamano_bytes, subido_en';

// POST /api/cuentas/facturas/:id/comprobantes  { nombre, tipo_mime, contenido (base64) }
exports.subirComprobante = async (req, res) => {
    const facturaId = parseInt(req.params.id);
    if (!facturaId) return res.status(400).json({ message: 'Factura inválida' });

    try {
        const almacen = almacenOError();
        // Se revisan las reglas antes de guardar nada en Storage
        exigirAbierta(await facturaDelPadre(db, facturaId, req.user.id));
        if ((await cantidadDe(db, facturaId)) >= MAX_POR_FACTURA) throw new ReglaError(409, `Una factura admite hasta ${MAX_POR_FACTURA} comprobantes`);
        const archivo = validarArchivo(req.body);
        if (archivo.error) throw new ReglaError(archivo.estado, archivo.error);

        const ruta = rutaStorage(req.user.id, facturaId, archivo.tipo, crypto.randomBytes(12).toString('hex'));
        await almacen.subir(ruta, archivo.buffer, archivo.tipo);

        const cliente = await db.getClient();
        try {
            await cliente.query('BEGIN');
            const factura = await facturaDelPadre(cliente, facturaId, req.user.id, true);
            exigirAbierta(factura);
            if ((await cantidadDe(cliente, facturaId)) >= MAX_POR_FACTURA) throw new ReglaError(409, `Una factura admite hasta ${MAX_POR_FACTURA} comprobantes`);
            const comprobante = (await cliente.query(
                `INSERT INTO comprobantes_pago (factura_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, subido_por)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS}`,
                [facturaId, archivo.nombre, ruta, archivo.tipo, archivo.buffer.length, req.user.id]
            )).rows[0];
            const estado = (await cliente.query(
                `UPDATE facturas SET estado = 'En revision' WHERE id = $1 AND estado = 'Pendiente' RETURNING estado`, [facturaId]
            )).rows[0];
            await cliente.query('COMMIT');
            res.status(201).json({ comprobante, factura_estado: estado ? estado.estado : factura.estado });
        } catch (err) {
            await cliente.query('ROLLBACK').catch(() => {});
            await almacen.borrar(ruta).catch(() => {}); // no queda un archivo huérfano sin su registro
            throw err;
        } finally {
            cliente.release();
        }
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/cuentas/facturas/:id/comprobantes
exports.listarComprobantes = async (req, res) => {
    const facturaId = parseInt(req.params.id);
    if (!facturaId) return res.status(400).json({ message: 'Factura inválida' });
    try {
        const factura = await facturaDelPadre(db, facturaId, req.user.id);
        const comprobantes = (await db.query(`SELECT ${COLUMNAS} FROM comprobantes_pago WHERE factura_id = $1 ORDER BY subido_en, id`, [facturaId])).rows;
        res.json({ factura_id: facturaId, factura_estado: factura.estado, comprobantes, maximo: MAX_POR_FACTURA });
    } catch (err) {
        responderError(res, err);
    }
};

// Comprobante con su factura, solo si es del padre
async function comprobanteDelPadre(comprobanteId, padreId) {
    const fila = (await db.query(
        `SELECT c.id, c.factura_id, c.ruta_storage, f.tutor_id, f.estado
         FROM comprobantes_pago c JOIN facturas f ON f.id = c.factura_id WHERE c.id = $1`, [comprobanteId]
    )).rows[0];
    if (!fila) throw new ReglaError(404, 'Comprobante no encontrado');
    if (fila.tutor_id !== padreId) throw new ReglaError(403, 'No tenés acceso a este comprobante');
    return fila;
}

// GET /api/cuentas/comprobantes/:id/url: enlace temporal para ver el archivo (el bucket es privado)
exports.urlComprobante = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Comprobante inválido' });
    try {
        const almacen = almacenOError();
        const comprobante = await comprobanteDelPadre(id, req.user.id);
        res.json({ url: await almacen.urlFirmada(comprobante.ruta_storage, SEGUNDOS_ENLACE), vence_en_segundos: SEGUNDOS_ENLACE });
    } catch (err) {
        responderError(res, err);
    }
};

// DELETE /api/cuentas/comprobantes/:id: para corregir un archivo equivocado mientras la factura sigue abierta
exports.borrarComprobante = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Comprobante inválido' });
    try {
        const almacen = almacenOError();
        const comprobante = await comprobanteDelPadre(id, req.user.id);
        const cliente = await db.getClient();
        try {
            await cliente.query('BEGIN');
            exigirAbierta(await facturaDelPadre(cliente, comprobante.factura_id, req.user.id, true));
            await cliente.query('DELETE FROM comprobantes_pago WHERE id = $1', [id]);
            // Sin comprobantes la factura vuelve a esperar uno
            if ((await cantidadDe(cliente, comprobante.factura_id)) === 0) {
                await cliente.query(`UPDATE facturas SET estado = 'Pendiente' WHERE id = $1 AND estado = 'En revision'`, [comprobante.factura_id]);
            }
            await cliente.query('COMMIT');
        } catch (err) {
            await cliente.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            cliente.release();
        }
        await almacen.borrar(comprobante.ruta_storage).catch(() => {}); // si falla, solo queda un archivo suelto sin registro
        res.json({ message: 'Comprobante eliminado' });
    } catch (err) {
        responderError(res, err);
    }
};
