// Fichas completas de un alumno y de un docente. Las usan el reporte de la Dirección (administrador),
// el portal del padre (la ficha de sus hijos) y el portal del docente (sus cursos y horarios): así los tres
// ven exactamente los mismos datos, con el mismo formato de secciones (ver utils/reportes.js).
const db = require('../config/database');
const { rangoDelMes, ReglaError } = require('../utils/inscripciones');
const { describirHorario } = require('../utils/deportes');
const { legajoAlumnoSql, legajoDocenteSql, diaCapitalizado, seccion, reporte } = require('../utils/reportes');

const LEGAJO_ALUMNO = legajoAlumnoSql('a.id');

// Ficha de un alumno en un mes: datos, materias con sus profesores, deportes con horario, transporte y comedor.
async function fichaAlumno(alumnoId, mes, anio) {
    const { desde, hasta } = rangoDelMes(mes, anio);

    const alumno = (await db.query(
        `SELECT a.id, ${LEGAJO_ALUMNO} AS legajo, a.dni, a.apellido, a.nombre, a.estado,
                n.nombre AS nivel, c.division AS curso, c.id AS curso_id
         FROM alumnos a LEFT JOIN cursos c ON c.id = a.curso_id LEFT JOIN niveles n ON n.id = c.nivel_id
         WHERE a.id = $1`, [alumnoId]
    )).rows[0];
    if (!alumno) throw new ReglaError(404, 'Alumno no encontrado');

    const [materias, deportes, transporte, comedor] = await Promise.all([
        // Materias del curso del alumno y los profesores que las dictan (según los horarios cargados)
        db.query(
            `SELECT m.nombre AS materia,
                    COALESCE((SELECT string_agg(DISTINCT p.apellido || ', ' || p.nombre, ' / ' ORDER BY p.apellido || ', ' || p.nombre)
                              FROM horarios h JOIN personal p ON p.id = h.docente_id WHERE h.materia_id = m.id),
                             'Sin profesor asignado') AS profesor
             FROM materias m WHERE m.curso_id = $1 ORDER BY m.nombre`, [alumno.curso_id]
        ),
        db.query(
            `SELECT COALESCE(d.nombre, s.nombre) AS deporte, s.nombre AS grupo, ng.nombre AS nivel,
                    s.dia_semana, s.hora_inicio, s.hora_fin, (p.apellido || ', ' || p.nombre) AS profesor
             FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Deporte'
             LEFT JOIN actividades_extra d ON d.id = s.actividad_id
             LEFT JOIN niveles ng ON ng.id = s.nivel_id
             LEFT JOIN personal p ON p.id = s.docente_id
             WHERE i.alumno_id = $1 AND i.estado = 'Activa' AND i.mes = $2 AND i.anio = $3
             ORDER BY deporte`, [alumnoId, mes, anio]
        ),
        db.query(
            `WITH origen AS (
                 SELECT r.id AS ruta_id, r.nombre_ruta, r.chofer_nombre, ta.punto_encuentro, 'Asignación' AS origen, 1 AS prioridad
                 FROM transporte_asignaciones ta JOIN transporte_rutas r ON r.id = ta.ruta_id WHERE ta.alumno_id = $1
                 UNION ALL
                 SELECT r.id, r.nombre_ruta, r.chofer_nombre, NULL, 'Inscripción del mes', 2
                 FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Transporte'
                 JOIN transporte_rutas r ON r.id = s.ruta_id
                 WHERE i.alumno_id = $1 AND i.estado = 'Activa' AND i.mes = $2 AND i.anio = $3
             )
             SELECT DISTINCT ON (ruta_id) nombre_ruta AS recorrido, chofer_nombre AS chofer, punto_encuentro AS punto, origen
             FROM origen ORDER BY ruta_id, prioridad`, [alumnoId, mes, anio]
        ),
        db.query(
            `SELECT
                 EXISTS (SELECT 1 FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Comedor'
                         WHERE i.alumno_id = $1 AND i.estado = 'Activa' AND i.mes = $2 AND i.anio = $3) AS inscripto,
                 (SELECT COUNT(*) FILTER (WHERE consumio_menu)::int FROM comedor_asistencias WHERE alumno_id = $1 AND fecha >= $4 AND fecha < $5) AS consumidos,
                 (SELECT COUNT(*)::int FROM comedor_asistencias WHERE alumno_id = $1 AND fecha >= $4 AND fecha < $5) AS registrados`,
            [alumnoId, mes, anio, desde, hasta]
        ),
    ]);

    const c = comedor.rows[0];
    return reporte(`Reporte del alumno: ${alumno.apellido}, ${alumno.nombre}`, [
        seccion('Datos del alumno', [['legajo', 'Legajo'], ['dni', 'DNI'], ['apellido', 'Apellido'], ['nombre', 'Nombre'], ['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['estado', 'Estado']],
            [{ legajo: alumno.legajo, dni: alumno.dni, apellido: alumno.apellido, nombre: alumno.nombre, nivel: alumno.nivel || 'Sin curso', curso: alumno.curso || 'Sin curso', estado: alumno.estado }]),
        seccion('Materias y profesores', [['materia', 'Materia'], ['profesor', 'Profesor']], materias.rows),
        seccion(`Deportes y horarios (${mes}/${anio})`, [['deporte', 'Deporte'], ['grupo', 'Grupo'], ['nivel', 'Nivel'], ['horario', 'Horario'], ['profesor', 'Profesor']],
            deportes.rows.map((d) => ({ ...d, horario: d.dia_semana ? describirHorario(d) : 'Sin horario' }))),
        seccion('Transporte', [['recorrido', 'Recorrido'], ['chofer', 'Chofer'], ['punto', 'Punto de encuentro'], ['origen', 'Origen']],
            transporte.rows.map((t) => ({ ...t, punto: t.punto || '-' }))),
        seccion(`Comedor (${mes}/${anio})`, [['inscripto', 'Inscripto'], ['consumidos', 'Días con menú'], ['registrados', 'Días registrados']],
            [{ inscripto: c.inscripto ? 'Sí' : 'No', consumidos: c.consumidos, registrados: c.registrados }]),
    ], { alumno_id: alumnoId, mes, anio });
}

// Ficha de un docente: datos, cursos a cargo por nivel y horarios de cada curso (según los horarios cargados).
async function fichaDocente(docenteId) {
    const docente = (await db.query(
        `SELECT id, ${legajoDocenteSql('id')} AS legajo, dni, apellido, nombre, especialidad, email, telefono, estado
         FROM personal WHERE id = $1 AND tipo = 'Docente'`, [docenteId]
    )).rows[0];
    if (!docente) throw new ReglaError(404, 'Docente no encontrado');

    const [cursos, horarios] = await Promise.all([
        db.query(
            `SELECT n.nombre AS nivel, c.division AS curso, string_agg(DISTINCT m.nombre, ', ' ORDER BY m.nombre) AS materias
             FROM horarios h JOIN materias m ON m.id = h.materia_id JOIN cursos c ON c.id = m.curso_id JOIN niveles n ON n.id = c.nivel_id
             WHERE h.docente_id = $1 GROUP BY n.id, n.nombre, c.id, c.division ORDER BY n.nombre, c.division`, [docenteId]
        ),
        db.query(
            `SELECT n.nombre AS nivel, c.division AS curso, m.nombre AS materia, h.dia_semana, h.hora_inicio, h.hora_fin, au.nombre AS aula
             FROM horarios h JOIN materias m ON m.id = h.materia_id JOIN cursos c ON c.id = m.curso_id JOIN niveles n ON n.id = c.nivel_id
             LEFT JOIN aulas au ON au.id = h.aula_id
             WHERE h.docente_id = $1 ORDER BY n.nombre, c.division, h.dia_semana, h.hora_inicio`, [docenteId]
        ),
    ]);

    return reporte(`Reporte del docente: ${docente.apellido}, ${docente.nombre}`, [
        seccion('Datos del docente', [['legajo', 'Legajo'], ['dni', 'DNI'], ['apellido', 'Apellido'], ['nombre', 'Nombre'], ['especialidad', 'Especialidad'], ['email', 'Correo'], ['telefono', 'Teléfono'], ['estado', 'Estado']],
            [{ ...docente, especialidad: docente.especialidad || '-', email: docente.email || '-', telefono: docente.telefono || '-' }]),
        seccion('Cursos a cargo por nivel', [['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['materias', 'Materias']], cursos.rows),
        seccion('Horarios de cada curso', [['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['materia', 'Materia'], ['dia', 'Día'], ['inicio', 'Desde'], ['fin', 'Hasta'], ['aula', 'Aula']],
            horarios.rows.map((h) => ({ nivel: h.nivel, curso: h.curso, materia: h.materia, dia: diaCapitalizado(h.dia_semana), inicio: h.hora_inicio, fin: h.hora_fin, aula: h.aula || '-' }))),
    ], { docente_id: docenteId });
}

module.exports = { fichaAlumno, fichaDocente };
