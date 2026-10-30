// Cuenta corriente de la familia en la app móvil: cuotas e historial de pagos (HU6) y facturas para pagar por
// transferencia (HU7). Solo el padre/tutor, y solo de sus hijos.
const db = require('../config/database');
const { ReglaError } = require('../utils/inscripciones');
const { FILTROS, hoyEnArgentina, armarCuota, filtrarCuotas, sumar, totalPendiente, aCentavos } = require('../utils/cuotas');
const {
    claveItem, validarSeleccion, totalFactura, descripcionCuota, descripcionServicio, referenciaFactura, azarReferencia,
    datosBancarios, NOTA_PAGO,
} = require('../utils/facturas');

// Clase del bloqueo por padre al facturar (el segundo número es el id del padre)
const BLOQUEO_FACTURAS = 7001;

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
// `consulta` es la base o un cliente dentro de una transacción.
async function cuotasDe(hijos, hoy, consulta = db) {
    if (!hijos.length) return [];
    const [anio, mes] = hoy.split('-').map(Number);
    const filas = (await consulta.query(
        `SELECT a.id AS alumno_id, a.nombre, a.apellido, cc.id AS cuota_id, cc.mes, cc.anio, cc.monto, cc.vencimiento,
                COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.alumno_id = a.id AND p.cuota_id = cc.id), 0) AS pagado,
                EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                        WHERE fi.alumno_id = a.id AND fi.cuota_id = cc.id AND f.estado = 'Pagada') AS facturada_pagada,
                EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                        WHERE fi.alumno_id = a.id AND fi.cuota_id = cc.id AND f.estado = 'En revision') AS en_revision,
                (SELECT f.referencia FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                 WHERE fi.alumno_id = a.id AND fi.cuota_id = cc.id AND f.estado IN ('Pendiente', 'En revision') LIMIT 1) AS en_factura
         FROM alumnos a
         JOIN cursos c ON c.id = a.curso_id
         JOIN cuotas_config cc ON cc.nivel_id = c.nivel_id AND (cc.anio < $2 OR (cc.anio = $2 AND cc.mes <= $3))
         WHERE a.id = ANY($1)
         ORDER BY cc.anio DESC, cc.mes DESC, a.apellido, a.nombre`,
        [hijos, anio, mes]
    )).rows;
    return filas.map((f) => armarCuota(f, hoy));
}

// Servicios (deporte, transporte, comedor) inscriptos y activos de meses ya empezados que todavía no se abonaron.
async function serviciosDe(hijos, hoy, consulta = db) {
    if (!hijos.length) return [];
    const [anio, mes] = hoy.split('-').map(Number);
    const filas = (await consulta.query(
        `SELECT i.id AS inscripcion_id, i.alumno_id, a.apellido || ', ' || a.nombre AS alumno, s.tipo, s.nombre, s.precio_mensual AS monto, i.mes, i.anio,
                (SELECT f.referencia FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
                 WHERE fi.inscripcion_id = i.id AND f.estado IN ('Pendiente', 'En revision') LIMIT 1) AS en_factura
         FROM inscripciones_servicio i
         JOIN servicios s ON s.id = i.servicio_id
         JOIN alumnos a ON a.id = i.alumno_id
         WHERE i.alumno_id = ANY($1) AND i.estado = 'Activa' AND (i.anio < $2 OR (i.anio = $2 AND i.mes <= $3))
           AND NOT EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id WHERE fi.inscripcion_id = i.id AND f.estado = 'Pagada')
         ORDER BY i.anio DESC, i.mes DESC, a.apellido, s.tipo, s.nombre`,
        [hijos, anio, mes]
    )).rows;
    return filas.map((f) => ({ ...f, en_factura: f.en_factura || null }));
}

// Ítems que el padre puede elegir para pagar (cuotas con saldo y servicios sin abonar), cada uno con su monto exacto.
async function itemsPagables(hijos, hoy, consulta = db) {
    const [cuotas, servicios] = await Promise.all([cuotasDe(hijos, hoy, consulta), serviciosDe(hijos, hoy, consulta)]);
    return [
        ...cuotas.filter((c) => c.estado !== 'Pagada').map((c) => ({
            tipo: 'cuota', alumno_id: c.alumno_id, cuota_id: c.cuota_id, alumno: c.alumno, mes: c.mes, anio: c.anio,
            descripcion: descripcionCuota(c), monto: c.saldo, vencimiento: c.vencimiento, estado: c.estado, en_factura: c.en_factura,
        })),
        ...servicios.map((s) => ({
            tipo: 'servicio', alumno_id: s.alumno_id, inscripcion_id: s.inscripcion_id, alumno: s.alumno, mes: s.mes, anio: s.anio,
            descripcion: descripcionServicio(s), monto: Number(s.monto), vencimiento: null, estado: 'Pendiente', en_factura: s.en_factura,
        })),
    ].map((item) => ({ ...item, disponible: !item.en_factura }));
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

// GET /api/cuentas/pagables: lo que se puede elegir para pagar. Los ítems que ya están en una factura abierta
// se muestran, pero con disponible = false (no se pueden facturar dos veces).
exports.getPagables = async (req, res) => {
    try {
        const items = await itemsPagables(await hijosDelPadre(req.user.id, null), hoyEnArgentina());
        res.json({ items, total_disponible: sumar(items.filter((i) => i.disponible).map((i) => i.monto)) });
    } catch (err) {
        responderError(res, err);
    }
};

const armarFactura = (factura, items) => ({
    id: factura.id,
    referencia: factura.referencia,
    total: factura.total,
    estado: factura.estado,
    emitida_en: factura.emitida_en,
    items,
});

const ITEMS_DE_FACTURA = `SELECT fi.id, fi.factura_id, fi.alumno_id, fi.cuota_id, fi.inscripcion_id, fi.descripcion, fi.monto
                          FROM factura_items fi WHERE fi.factura_id = ANY($1) ORDER BY fi.id`;

// POST /api/cuentas/facturas  { items: [{ tipo: 'cuota', alumno_id, cuota_id } | { tipo: 'servicio', inscripcion_id }] }
// Arma la factura consolidada. Los montos salen siempre de la base, nunca de lo que manda la app.
exports.crearFactura = async (req, res) => {
    const seleccion = validarSeleccion(req.body && req.body.items);
    if (seleccion.error) return res.status(400).json({ message: seleccion.error });

    let cliente;
    try {
        cliente = await db.getClient();
        await cliente.query('BEGIN');
        // Una factura a la vez por padre: dos pedidos simultáneos no pueden facturar el mismo ítem. Se usa un bloqueo
        // de la transacción (no de una fila) porque el ítem se lee antes de insertar y la fila del usuario ya se comparte por la clave foránea.
        await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [BLOQUEO_FACTURAS, req.user.id]);

        const hijos = await hijosDelPadre(req.user.id, null);
        const hoy = hoyEnArgentina();
        const disponibles = new Map((await itemsPagables(hijos, hoy, cliente)).map((i) => [claveItem(i), i]));

        const elegidos = seleccion.items.map((pedido) => {
            const item = disponibles.get(claveItem(pedido));
            if (!item) throw new ReglaError(409, 'Un ítem no existe, ya está abonado o no es de tus hijos');
            if (!item.disponible) throw new ReglaError(409, `"${item.descripcion}" ya está en la factura ${item.en_factura}`);
            return item;
        });
        const total = totalFactura(elegidos);
        if (!(aCentavos(total) > 0)) throw new ReglaError(409, 'El total a pagar tiene que ser mayor a cero');

        let factura;
        for (let intento = 0; !factura; intento++) {
            await cliente.query('SAVEPOINT referencia');
            try {
                factura = (await cliente.query(
                    `INSERT INTO facturas (tutor_id, referencia, total, estado) VALUES ($1, $2, $3, 'Pendiente')
                     RETURNING id, referencia, total, estado, emitida_en`,
                    [req.user.id, referenciaFactura(hoy, azarReferencia()), total]
                )).rows[0];
            } catch (err) {
                // 23505: la referencia (que se genera al azar) ya existía; se prueba con otra
                if (err.code !== '23505' || intento >= 4) throw err;
                await cliente.query('ROLLBACK TO SAVEPOINT referencia');
            }
        }
        for (const item of elegidos) {
            await cliente.query(
                `INSERT INTO factura_items (factura_id, alumno_id, cuota_id, inscripcion_id, descripcion, monto) VALUES ($1, $2, $3, $4, $5, $6)`,
                [factura.id, item.alumno_id, item.cuota_id || null, item.inscripcion_id || null, item.descripcion, item.monto]
            );
        }
        const guardados = (await cliente.query(ITEMS_DE_FACTURA, [[factura.id]])).rows;
        await cliente.query('COMMIT');
        res.status(201).json({ ...armarFactura(factura, guardados), pago: { metodo: 'Transferencia bancaria', datos: datosBancarios(), nota: NOTA_PAGO } });
    } catch (err) {
        if (cliente) await cliente.query('ROLLBACK').catch(() => {});
        responderError(res, err);
    } finally {
        if (cliente) cliente.release();
    }
};

// GET /api/cuentas/facturas: las facturas del padre, de la más nueva a la más vieja
exports.listarFacturas = async (req, res) => {
    try {
        const facturas = (await db.query(
            'SELECT id, referencia, total, estado, emitida_en FROM facturas WHERE tutor_id = $1 ORDER BY emitida_en DESC, id DESC', [req.user.id]
        )).rows;
        const items = facturas.length ? (await db.query(ITEMS_DE_FACTURA, [facturas.map((f) => f.id)])).rows : [];
        res.json({ facturas: facturas.map((f) => armarFactura(f, items.filter((i) => i.factura_id === f.id))) });
    } catch (err) {
        responderError(res, err);
    }
};

// GET /api/cuentas/facturas/:id
exports.getFactura = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Factura inválida' });
    try {
        const factura = (await db.query('SELECT id, tutor_id, referencia, total, estado, emitida_en FROM facturas WHERE id = $1', [id])).rows[0];
        if (!factura) return res.status(404).json({ message: 'Factura no encontrada' });
        if (factura.tutor_id !== req.user.id) return res.status(403).json({ message: 'No tenés acceso a esta factura' });
        const items = (await db.query(ITEMS_DE_FACTURA, [[id]])).rows;
        res.json({ ...armarFactura(factura, items), pago: { metodo: 'Transferencia bancaria', datos: datosBancarios(), nota: NOTA_PAGO } });
    } catch (err) {
        responderError(res, err);
    }
};
