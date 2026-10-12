// Patrón FACADE (estructural) aplicado al módulo financiero (HU6).
//
// Problema: registrar un pago implica varios pasos (validar, abrir transacción, insertar el
// pago, actualizar el saldo, confirmar o revertir) y emitir un comprobante implica otros
// (consultar, controlar el acceso, dibujar el PDF). El controlador mezclaba todo eso.
// Solución: una fachada con dos operaciones simples. El controlador solo traduce el
// resultado a HTTP y no conoce los detalles internos.
const db = require('../config/database');
const { dibujarComprobante } = require('./comprobantePdf');

const CONSULTA_COMPROBANTE = `
    SELECT p.id, p.monto_pagado, p.fecha_pago, p.metodo_pago,
           a.nombre AS alumno_nombre, a.apellido AS alumno_apellido, a.dni AS alumno_dni,
           a.tutor_id,
           niveles.nombre AS nivel_nombre, cursos.division AS division,
           cc.mes AS cuota_mes, cc.anio AS cuota_anio,
           COALESCE(s.saldo_pendiente, 0) AS saldo_pendiente
    FROM pagos p
    LEFT JOIN alumnos a ON p.alumno_id = a.id
    LEFT JOIN cursos ON a.curso_id = cursos.id
    LEFT JOIN niveles ON cursos.nivel_id = niveles.id
    LEFT JOIN cuotas_config cc ON p.cuota_id = cc.id
    LEFT JOIN saldos_alumnos s ON s.alumno_id = a.id
    WHERE p.id = $1
`;

const PagosFacade = {
    // Valida y registra un pago y descuenta el saldo del alumno en UNA transacción: si un
    // paso falla se revierte todo. Devuelve { ok: true, pagoId } o { ok: false, status, message }.
    async registrarPago({ alumno_id, cuota_id, monto_pagado, metodo_pago }) {
        if (!alumno_id || monto_pagado === undefined || monto_pagado === null || monto_pagado === '') {
            return { ok: false, status: 400, message: 'Datos incompletos' };
        }
        const monto = parseFloat(monto_pagado);
        if (isNaN(monto) || monto <= 0) {
            return { ok: false, status: 400, message: 'El monto pagado debe ser un número mayor a 0' };
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const pago = await client.query(
                'INSERT INTO pagos (alumno_id, cuota_id, monto_pagado, metodo_pago) VALUES ($1, $2, $3, $4) RETURNING id',
                [alumno_id, cuota_id, monto, metodo_pago]
            );

            await client.query(
                `INSERT INTO saldos_alumnos (alumno_id, saldo_pendiente)
                 VALUES ($1, -$2::numeric)
                 ON CONFLICT (alumno_id) DO UPDATE SET
                    saldo_pendiente = saldos_alumnos.saldo_pendiente - $2::numeric,
                    ultima_actualizacion = CURRENT_TIMESTAMP`,
                [alumno_id, monto]
            );

            await client.query('COMMIT');
            return { ok: true, pagoId: pago.rows[0].id };
        } catch (err) {
            await client.query('ROLLBACK');
            return { ok: false, status: 500, message: 'Error al registrar el pago' };
        } finally {
            client.release();
        }
    },

    // Busca el pago, controla el acceso (un padre solo ve los de sus hijos) y, si todo está
    // bien, dibuja el PDF en `salida`. `onListo(pago)` se llama antes de escribir, para que
    // el controlador pueda fijar las cabeceras HTTP. Devuelve { ok } o { ok: false, status, message }.
    async emitirComprobante({ pagoId, usuario, salida, onListo }) {
        let pago;
        try {
            const result = await db.query(CONSULTA_COMPROBANTE, [pagoId]);
            pago = result.rows[0];
        } catch (err) {
            return { ok: false, status: 500, message: err.message };
        }

        if (!pago) return { ok: false, status: 404, message: 'Pago no encontrado' };

        if (usuario.rol === 'padre' && pago.tutor_id !== usuario.id) {
            return { ok: false, status: 403, message: 'No tiene acceso a este comprobante' };
        }

        if (onListo) onListo(pago);
        dibujarComprobante(pago, salida);
        return { ok: true };
    }
};

module.exports = PagosFacade;
