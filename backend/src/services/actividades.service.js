// Deportes por grupo dentro del panel de actividades del docente (ARTE-2, Sprint C2).
//
// Los deportes se inscriben por grupo (servicios de tipo Deporte con actividad_id, nivel, horario y profesor) y las
// inscripciones son mensuales. Cultura e Idioma siguen en el sistema anterior (inscripciones_extra, por cuenta de
// alumno): este servicio solo cubre los deportes.
const db = require('../config/database');

// Tipo de una actividad, o null si no existe.
async function actividadPorId(actividadId) {
    const r = await db.query('SELECT id, nombre, tipo FROM actividades_extra WHERE id = $1', [actividadId]);
    return r.rows[0] || null;
}

// Alumnos activos inscriptos en los grupos de un deporte en un mes, con su última nota.
// Con docenteId, solo los de los grupos que dicta ese docente.
async function inscriptosDeDeporte(actividadId, mes, anio, docenteId = null) {
    const r = await db.query(
        `SELECT a.id AS alumno_id, (a.apellido || ', ' || a.nombre) AS alumno_nombre,
                MIN(i.creada_en) AS fecha_inscripcion,
                (SELECT nota FROM actividad_calificaciones
                  WHERE actividad_id = $1 AND legajo_id = a.id ORDER BY id DESC LIMIT 1) AS ultima_nota
         FROM inscripciones_servicio i
         JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Deporte' AND s.actividad_id = $1
         JOIN alumnos a ON a.id = i.alumno_id AND a.estado = 'Activo'
         WHERE i.estado = 'Activa' AND i.mes = $2 AND i.anio = $3
           AND ($4::int IS NULL OR s.docente_id = $4)
         GROUP BY a.id, a.apellido, a.nombre
         ORDER BY a.apellido, a.nombre`,
        [actividadId, mes, anio, docenteId]
    );
    return r.rows;
}

async function estaInscriptoEnDeporte(actividadId, alumnoId, mes, anio, docenteId = null) {
    const inscriptos = await inscriptosDeDeporte(actividadId, mes, anio, docenteId);
    return inscriptos.some((i) => i.alumno_id === alumnoId);
}

module.exports = { actividadPorId, inscriptosDeDeporte, estaInscriptoEnDeporte };
