// Envío automático de correos a las familias (HU10):
//  - Factura de fin de mes: el último día hábil se emite la factura con lo pendiente de cada familia y se envía con el PDF adjunto.
//  - Aviso de deuda: el día 20 a quienes tienen pagos pendientes o incompletos.
// Cada intento queda en `correos_enviados`. Lo enviado no se repite en el mismo período, un error se reintenta, y dos
// ejecuciones a la vez no se pisan (bloqueo de la sesión). Las familias sin un correo válido como usuario se registran como "Omitido".
const { PassThrough } = require('stream');
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { hoyEnArgentina } = require('../utils/cuotas');
const { totalFactura, datosBancarios } = require('../utils/facturas');
const { TIPOS, feriadosDe, periodoDe, tareasDelDia, esCorreo, armarCorreoFactura, armarAvisoDeuda } = require('../utils/correos');
const { dibujarFactura } = require('./facturasPdf');
const { obtenerProveedor, CorreoError } = require('./correo');
const cuentas = require('../controllers/cuentas.controller');

const BLOQUEO_CORREOS = [7002, 1];
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const aBuffer = (dibujar) => new Promise((resolve, reject) => {
    const salida = new PassThrough();
    const trozos = [];
    salida.on('data', (t) => trozos.push(t));
    salida.on('end', () => resolve(Buffer.concat(trozos)));
    salida.on('error', reject);
    dibujar(salida);
});

async function registrar({ tipo, periodo, padre, asunto, estado, detalle = null, proveedorId = null, facturaId = null }) {
    await db.query(
        `INSERT INTO correos_enviados (tipo, periodo, usuario_id, destinatario, asunto, estado, detalle, proveedor_id, factura_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [tipo, periodo, padre.id, padre.username, asunto, estado, detalle, proveedorId, facturaId]
    );
}

const yaRegistrado = async (tipo, periodo, padreId) => (await db.query(
    `SELECT estado FROM correos_enviados WHERE tipo = $1 AND periodo = $2 AND usuario_id = $3 AND estado IN ('Enviado', 'Omitido') LIMIT 1`, [tipo, periodo, padreId]
)).rows[0];

// Factura que quedó emitida pero cuyo correo falló en un intento anterior del mismo período
async function facturaPendienteDeEnvio(periodo, padreId) {
    const fila = (await db.query(
        `SELECT c.factura_id FROM correos_enviados c JOIN facturas f ON f.id = c.factura_id
         WHERE c.tipo = 'factura_fin_de_mes' AND c.periodo = $1 AND c.usuario_id = $2 AND c.estado = 'Error' AND f.estado = 'Pendiente'
         ORDER BY c.id DESC LIMIT 1`, [periodo, padreId]
    )).rows[0];
    if (!fila) return null;
    const factura = (await db.query('SELECT id, referencia, total, estado, emitida_en FROM facturas WHERE id = $1', [fila.factura_id])).rows[0];
    const items = (await db.query(cuentas.ITEMS_DE_FACTURA, [[factura.id]])).rows;
    return { factura, items };
}

// Envía y registra. Devuelve { resultado, detalle }
async function enviarYRegistrar({ proveedor, tipo, periodo, padre, mensaje, adjuntos, facturaId }) {
    try {
        const { id } = await proveedor.enviar({ para: padre.username, asunto: mensaje.asunto, html: mensaje.html, texto: mensaje.texto, adjuntos });
        const detalle = proveedor.redirigeA ? `Redirigido a ${proveedor.redirigeA} (modo de prueba)` : null;
        await registrar({ tipo, periodo, padre, asunto: mensaje.asunto, estado: 'Enviado', detalle, proveedorId: id, facturaId });
        return { resultado: 'Enviado', detalle };
    } catch (err) {
        if (!(err instanceof CorreoError)) throw err;
        await registrar({ tipo, periodo, padre, asunto: mensaje.asunto, estado: 'Error', detalle: err.message, facturaId });
        return { resultado: 'Error', detalle: err.message };
    }
}

async function procesarPadre({ tipo, periodo, hoy, padre, simular, proveedor }) {
    if (await yaRegistrado(tipo, periodo, padre.id)) return { resultado: 'Ya enviado' };
    const hijos = await cuentas.hijosDelPadre(padre.id, null);
    const items = await cuentas.itemsPagables(hijos, hoy);
    const conCorreo = esCorreo(padre.username);

    if (tipo === 'aviso_deuda') {
        const deuda = items.filter((i) => i.estado !== 'En revision'); // lo que ya pagó y espera la revisión no es deuda
        if (deuda.length === 0) return { resultado: 'Sin deuda' };
        const mensaje = armarAvisoDeuda({ nombre: padre.nombre, items: deuda, hoy });
        if (simular) return { resultado: 'Se enviaría', detalle: `${deuda.length} ítems, ${mensaje.total}`, sinCorreo: !conCorreo };
        if (!conCorreo) { await registrar({ tipo, periodo, padre, asunto: mensaje.asunto, estado: 'Omitido', detalle: 'La cuenta no tiene un correo válido como usuario' }); return { resultado: 'Omitido', detalle: 'Sin correo' }; }
        return enviarYRegistrar({ proveedor, tipo, periodo, padre, mensaje });
    }

    // Factura de fin de mes: se reutiliza la que quedó sin enviar, o se emite una con todo lo que se puede facturar
    let emitida = await facturaPendienteDeEnvio(periodo, padre.id);
    if (!emitida) {
        const facturables = items.filter((i) => i.disponible);
        if (facturables.length === 0) return { resultado: 'Sin ítems' };
        if (simular) return { resultado: 'Se enviaría', detalle: `${facturables.length} ítems, ${totalFactura(facturables)}`, sinCorreo: !conCorreo };
        emitida = await cuentas.emitirFactura(padre.id, facturables.map((i) => (i.tipo === 'cuota' ? { tipo: 'cuota', alumno_id: i.alumno_id, cuota_id: i.cuota_id } : { tipo: 'servicio', inscripcion_id: i.inscripcion_id })));
    } else if (simular) {
        return { resultado: 'Se enviaría', detalle: 'reintento de una factura ya emitida', sinCorreo: !conCorreo };
    }
    const { factura, items: guardados } = emitida;
    const mensaje = armarCorreoFactura({ nombre: padre.nombre, factura: { ...factura, items: guardados }, datosBancarios: datosBancarios(), hoy });
    if (!conCorreo) {
        await registrar({ tipo, periodo, padre, asunto: mensaje.asunto, estado: 'Omitido', detalle: 'La cuenta no tiene un correo válido como usuario; la factura se emitió igual y se ve en la app', facturaId: factura.id });
        return { resultado: 'Omitido', detalle: 'Sin correo (la factura se emitió igual)' };
    }
    const pdf = await aBuffer((salida) => dibujarFactura({ ...factura, padre: padre.nombre, items: guardados }, salida));
    return enviarYRegistrar({ proveedor, tipo, periodo, padre, mensaje, adjuntos: [{ nombre: `factura-${factura.referencia}.pdf`, contenido: pdf }], facturaId: factura.id });
}

// Corre las tareas que corresponden a `hoy` (o las pedidas). `simular` solo informa a quién se le enviaría.
async function ejecutarTareas({ hoy = hoyEnArgentina(), tipos = null, simular = false, padreIds = null, pausaMs = 650, proveedor = obtenerProveedor(), feriados = feriadosDe(process.env.FERIADOS) } = {}) {
    if (!simular && !proveedor) throw new ReglaError(503, 'El envío de correos no está configurado (falta RESEND_API_KEY)');
    const tareas = tipos && tipos.length ? tipos.filter((t) => TIPOS.includes(t)) : tareasDelDia(hoy, feriados);
    const periodo = periodoDe(hoy);

    // Una sola ejecución a la vez: el bloqueo vive mientras dure la conexión
    const cliente = await db.getClient();
    try {
        if (!(await cliente.query('SELECT pg_try_advisory_lock($1, $2) AS ok', BLOQUEO_CORREOS)).rows[0].ok) {
            throw new ReglaError(409, 'Ya hay un envío de correos en curso');
        }
        const padres = tareas.length
            ? (await db.query("SELECT id, username, nombre FROM users WHERE rol = 'padre' AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY id", [padreIds])).rows
            : [];
        const resultados = [];
        for (const tipo of tareas) {
            for (const padre of padres) {
                const r = await procesarPadre({ tipo, periodo, hoy, padre, simular, proveedor });
                resultados.push({ tarea: tipo, usuario: padre.username, nombre: padre.nombre, ...r });
                if (!simular && (r.resultado === 'Enviado' || (r.resultado === 'Error')) && pausaMs > 0) await esperar(pausaMs);
            }
        }
        const conteo = {};
        for (const r of resultados) conteo[r.resultado] = (conteo[r.resultado] || 0) + 1;
        return { hoy, periodo, simulado: simular, tareas, conteo, resultados };
    } finally {
        await cliente.query('SELECT pg_advisory_unlock($1, $2)', BLOQUEO_CORREOS).catch(() => {});
        cliente.release();
    }
}

module.exports = { ejecutarTareas };
