const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');

exports.getEstadisticasGenerales = async (req, res) => {
    try {
        const [alumnosRes, deudaRes, preinscRes, docentesRes] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM alumnos'),
            db.query('SELECT SUM(saldo_pendiente) as total FROM saldos_alumnos'),
            db.query("SELECT COUNT(*) as count FROM preinscripciones WHERE estado = 'pendiente'"),
            db.query("SELECT COUNT(*) as count FROM personal WHERE tipo = 'Docente'")
        ]);

        res.json({
            total_alumnos: alumnosRes.rows[0].count,
            deuda_total: deudaRes.rows[0].total || 0,
            preinscripciones_pendientes: preinscRes.rows[0].count,
            total_docentes: docentesRes.rows[0].count
        });
    } catch (err) {
        responderErrorInterno(res, err);
    }
};

// Reporte académico: calificaciones por alumno y materia (para visualización/impresión).
exports.getReporteAcademico = async (req, res) => {
    const query = `
        SELECT a.apellido, a.nombre, a.dni,
               niveles.nombre AS nivel_nombre, cursos.division,
               materias.nombre AS materia_nombre,
               c.nota, c.trimestre
        FROM calificaciones c
        JOIN alumnos a ON c.alumno_id = a.id
        LEFT JOIN materias ON c.materia_id = materias.id
        LEFT JOIN cursos ON a.curso_id = cursos.id
        LEFT JOIN niveles ON cursos.nivel_id = niveles.id
        ORDER BY a.apellido, a.nombre, materias.nombre, c.trimestre
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        responderErrorInterno(res, err);
    }
};

// Reporte financiero: detalle de pagos registrados (para visualización/impresión).
exports.getReporteFinanciero = async (req, res) => {
    const query = `
        SELECT p.fecha_pago, a.apellido, a.nombre, a.dni,
               p.monto_pagado, p.metodo_pago,
               COALESCE(s.saldo_pendiente, 0) AS saldo_pendiente
        FROM pagos p
        LEFT JOIN alumnos a ON p.alumno_id = a.id
        LEFT JOIN saldos_alumnos s ON s.alumno_id = a.id
        ORDER BY p.fecha_pago DESC
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        responderErrorInterno(res, err);
    }
};
