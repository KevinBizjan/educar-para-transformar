// Reportes de la Dirección (ARTE-2): los 9 listados del enunciado. Solo para el administrador.
//
// Todos responden con el mismo formato (ver utils/reportes.js) y admiten ?formato=csv para descargar.
// Los datos de deportes y de comedor son los del MES indicado (por defecto, el actual), porque las
// inscripciones a servicios son mensuales. Las listas de alumnos incluyen solo a los alumnos activos.
const db = require('../config/database');
const { validarMesAnio, rangoDelMes } = require('../utils/inscripciones');
const { describirHorario } = require('../utils/deportes');
const { legajo, diaCapitalizado, seccion, reporte, aCsv, nombreArchivo, CATALOGO } = require('../utils/reportes');

const entero = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
};
const periodoActual = () => { const h = new Date(); return { mes: h.getMonth() + 1, anio: h.getFullYear() }; };

class Peticion extends Error {
    constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

// Lee los filtros numéricos (todos opcionales salvo los que se pidan) y el período.
const leerFiltros = (query, claves = []) => {
    const filtros = {};
    for (const clave of claves) {
        const valor = entero(query[clave]);
        if (valor === undefined) throw new Peticion(400, `El filtro ${clave} debe ser un número entero mayor a 0`);
        filtros[clave] = valor;
    }
    return filtros;
};
const leerPeriodo = (query) => {
    const base = periodoActual();
    const mes = query.mes === undefined ? base.mes : parseInt(query.mes);
    const anio = query.anio === undefined ? base.anio : parseInt(query.anio);
    const error = validarMesAnio(mes, anio);
    if (error) throw new Peticion(400, error);
    return { mes, anio };
};

// Responde en JSON o, con ?formato=csv, como archivo descargable.
const responder = (req, res, id, rep) => {
    if (req.query.formato === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(id)}"`);
        return res.send(aCsv(rep));
    }
    return res.json(rep);
};

// Envoltorio común: maneja los errores de petición y los inesperados.
const manejar = (id, generar) => async (req, res) => {
    try {
        const rep = await generar(req);
        return responder(req, res, id, rep);
    } catch (err) {
        if (err instanceof Peticion) return res.status(err.estado).json({ message: err.message });
        return res.status(500).json({ message: 'Error en el servidor' });
    }
};

const LEGAJO_ALUMNO = "'A-' || LPAD(a.id::text, 5, '0')";
const ALUMNO_NOMBRE = "a.apellido || ', ' || a.nombre";

// ---------------------------------------------------------------------------------------------
// Opciones para armar los filtros de la pantalla
// ---------------------------------------------------------------------------------------------
exports.getCatalogo = (req, res) => res.json(CATALOGO);

exports.getOpciones = async (req, res) => {
    try {
        const [niveles, cursos, materias, docentes, deportes, rutas, alumnos] = await Promise.all([
            db.query('SELECT id, nombre FROM niveles ORDER BY nombre'),
            db.query('SELECT c.id, c.nivel_id, c.division, n.nombre AS nivel FROM cursos c JOIN niveles n ON n.id = c.nivel_id ORDER BY n.nombre, c.division'),
            db.query('SELECT m.id, m.curso_id, m.nombre FROM materias m ORDER BY m.nombre'),
            db.query("SELECT id, apellido, nombre FROM personal WHERE tipo = 'Docente' ORDER BY apellido, nombre"),
            db.query("SELECT id, nombre FROM actividades_extra WHERE tipo = 'Deporte' ORDER BY nombre"),
            db.query('SELECT id, nombre_ruta AS nombre FROM transporte_rutas ORDER BY nombre_ruta'),
            db.query(`SELECT a.id, a.apellido, a.nombre, ${LEGAJO_ALUMNO} AS legajo FROM alumnos a WHERE a.estado = 'Activo' ORDER BY a.apellido, a.nombre`),
        ]);
        res.json({
            niveles: niveles.rows, cursos: cursos.rows, materias: materias.rows, docentes: docentes.rows,
            deportes: deportes.rows, rutas: rutas.rows, alumnos: alumnos.rows,
        });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// ---------------------------------------------------------------------------------------------
// 1. Por alumno
// ---------------------------------------------------------------------------------------------
exports.porAlumno = manejar('reporte-alumno', async (req) => {
    const alumnoId = entero(req.params.id);
    if (!alumnoId) throw new Peticion(400, 'Alumno inválido');
    const { mes, anio } = leerPeriodo(req.query);
    const { desde, hasta } = rangoDelMes(mes, anio);

    const alumno = (await db.query(
        `SELECT a.id, ${LEGAJO_ALUMNO} AS legajo, a.dni, a.apellido, a.nombre, a.estado,
                n.nombre AS nivel, c.division AS curso, c.id AS curso_id
         FROM alumnos a LEFT JOIN cursos c ON c.id = a.curso_id LEFT JOIN niveles n ON n.id = c.nivel_id
         WHERE a.id = $1`, [alumnoId]
    )).rows[0];
    if (!alumno) throw new Peticion(404, 'Alumno no encontrado');

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
});

// ---------------------------------------------------------------------------------------------
// 2. Por docente
// ---------------------------------------------------------------------------------------------
exports.porDocente = manejar('reporte-docente', async (req) => {
    const docenteId = entero(req.params.id);
    if (!docenteId) throw new Peticion(400, 'Docente inválido');

    const docente = (await db.query(
        `SELECT id, 'D-' || LPAD(id::text, 5, '0') AS legajo, dni, apellido, nombre, especialidad, email, telefono, estado
         FROM personal WHERE id = $1 AND tipo = 'Docente'`, [docenteId]
    )).rows[0];
    if (!docente) throw new Peticion(404, 'Docente no encontrado');

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
});

// ---------------------------------------------------------------------------------------------
// 3. Alumnos por curso
// ---------------------------------------------------------------------------------------------
exports.alumnosPorCurso = manejar('alumnos-por-curso', async (req) => {
    const f = leerFiltros(req.query, ['nivel_id', 'curso_id']);
    const r = await db.query(
        `SELECT n.nombre AS nivel, c.division AS curso, ${LEGAJO_ALUMNO} AS legajo, a.apellido, a.nombre
         FROM alumnos a JOIN cursos c ON c.id = a.curso_id JOIN niveles n ON n.id = c.nivel_id
         WHERE a.estado = 'Activo' AND ($1::int IS NULL OR n.id = $1) AND ($2::int IS NULL OR c.id = $2)
         ORDER BY n.nombre, c.division, a.apellido, a.nombre`, [f.nivel_id, f.curso_id]
    );
    return reporte('Listado de alumnos por curso',
        [seccion('Alumnos', [['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['legajo', 'Legajo'], ['apellido', 'Apellido'], ['nombre', 'Nombre']], r.rows)], f);
});

// ---------------------------------------------------------------------------------------------
// 4. Alumnos por materia (el alumno cursa las materias de su curso)
// ---------------------------------------------------------------------------------------------
exports.alumnosPorMateria = manejar('alumnos-por-materia', async (req) => {
    const f = leerFiltros(req.query, ['nivel_id', 'curso_id', 'materia_id']);
    const r = await db.query(
        `SELECT n.nombre AS nivel, c.division AS curso, m.nombre AS materia,
                COALESCE((SELECT string_agg(DISTINCT p.apellido || ', ' || p.nombre, ' / ' ORDER BY p.apellido || ', ' || p.nombre)
                          FROM horarios h JOIN personal p ON p.id = h.docente_id WHERE h.materia_id = m.id),
                         'Sin profesor asignado') AS profesor,
                ${ALUMNO_NOMBRE} AS alumno, ${LEGAJO_ALUMNO} AS legajo
         FROM materias m JOIN cursos c ON c.id = m.curso_id JOIN niveles n ON n.id = c.nivel_id
         JOIN alumnos a ON a.curso_id = c.id AND a.estado = 'Activo'
         WHERE ($1::int IS NULL OR n.id = $1) AND ($2::int IS NULL OR c.id = $2) AND ($3::int IS NULL OR m.id = $3)
         ORDER BY n.nombre, c.division, m.nombre, a.apellido, a.nombre`, [f.nivel_id, f.curso_id, f.materia_id]
    );
    return reporte('Listado de alumnos por materia',
        [seccion('Alumnos', [['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['materia', 'Materia'], ['profesor', 'Profesor a cargo'], ['alumno', 'Alumno'], ['legajo', 'Legajo']], r.rows)], f);
});

// ---------------------------------------------------------------------------------------------
// 5. Docentes por nivel educativo (según los horarios de clase cargados)
// ---------------------------------------------------------------------------------------------
exports.docentesPorNivel = manejar('docentes-por-nivel', async (req) => {
    const f = leerFiltros(req.query, ['nivel_id']);
    const r = await db.query(
        `SELECT n.nombre AS nivel, p.apellido || ', ' || p.nombre AS profesor,
                string_agg(DISTINCT m.nombre, ', ' ORDER BY m.nombre) AS materias,
                string_agg(DISTINCT c.division, ', ' ORDER BY c.division) AS cursos
         FROM horarios h JOIN materias m ON m.id = h.materia_id JOIN cursos c ON c.id = m.curso_id
         JOIN niveles n ON n.id = c.nivel_id JOIN personal p ON p.id = h.docente_id
         WHERE $1::int IS NULL OR n.id = $1
         GROUP BY n.id, n.nombre, p.id, p.apellido, p.nombre ORDER BY n.nombre, p.apellido, p.nombre`, [f.nivel_id]
    );
    return reporte('Listado de docentes por nivel educativo',
        [seccion('Docentes', [['nivel', 'Nivel educativo'], ['profesor', 'Profesor'], ['materias', 'Materias a cargo'], ['cursos', 'Cursos']], r.rows)], f);
});

// ---------------------------------------------------------------------------------------------
// 6, 7 y 8. Alumnos por deporte (del mes indicado). Los tres usan la misma consulta.
// ---------------------------------------------------------------------------------------------
const alumnosDeDeportes = async (filtros, mes, anio) => (await db.query(
    `SELECT COALESCE(d.nombre, s.nombre) AS deporte, ng.nombre AS nivel_grupo, s.dia_semana, s.hora_inicio, s.hora_fin,
            COALESCE(p.apellido || ', ' || p.nombre, 'Sin profesor') AS profesor,
            ${ALUMNO_NOMBRE} AS alumno, COALESCE(c.division, 'Sin curso') AS curso, COALESCE(na.nombre, 'Sin curso') AS nivel_alumno
     FROM inscripciones_servicio i
     JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Deporte'
     JOIN alumnos a ON a.id = i.alumno_id AND a.estado = 'Activo'
     LEFT JOIN actividades_extra d ON d.id = s.actividad_id
     LEFT JOIN niveles ng ON ng.id = s.nivel_id
     LEFT JOIN personal p ON p.id = s.docente_id
     LEFT JOIN cursos c ON c.id = a.curso_id
     LEFT JOIN niveles na ON na.id = c.nivel_id
     WHERE i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
       AND ($3::int IS NULL OR s.actividad_id = $3) AND ($4::int IS NULL OR s.nivel_id = $4)
     ORDER BY deporte, ng.nombre, s.dia_semana, s.hora_inicio, a.apellido, a.nombre`,
    [mes, anio, filtros.actividad_id, filtros.nivel_id]
)).rows;

exports.alumnosPorDeporte = manejar('alumnos-por-deporte', async (req) => {
    const f = leerFiltros(req.query, ['actividad_id']);
    const p = leerPeriodo(req.query);
    const filas = await alumnosDeDeportes({ ...f, nivel_id: null }, p.mes, p.anio);
    return reporte(`Listado de alumnos por deporte (${p.mes}/${p.anio})`,
        [seccion('Alumnos', [['deporte', 'Deporte'], ['alumno', 'Alumno'], ['curso', 'Curso'], ['nivel_alumno', 'Nivel educativo']], filas)], { ...f, ...p });
});

exports.alumnosPorDeporteYNivel = manejar('alumnos-por-deporte-y-nivel', async (req) => {
    const f = leerFiltros(req.query, ['actividad_id', 'nivel_id']);
    const p = leerPeriodo(req.query);
    const filas = await alumnosDeDeportes(f, p.mes, p.anio);
    return reporte(`Listado de alumnos por deporte y nivel (${p.mes}/${p.anio})`,
        [seccion('Alumnos', [['deporte', 'Deporte'], ['nivel_grupo', 'Nivel'], ['alumno', 'Alumno'], ['curso', 'Curso']], filas.map((x) => ({ ...x, nivel_grupo: x.nivel_grupo || 'Sin nivel' })))], { ...f, ...p });
});

exports.alumnosPorDeporteNivelHorario = manejar('alumnos-por-deporte-nivel-horario', async (req) => {
    const f = leerFiltros(req.query, ['actividad_id', 'nivel_id']);
    const p = leerPeriodo(req.query);
    const filas = await alumnosDeDeportes(f, p.mes, p.anio);
    return reporte(`Listado de alumnos por deporte, nivel, horario y profesor (${p.mes}/${p.anio})`,
        [seccion('Alumnos', [['deporte', 'Deporte'], ['nivel_grupo', 'Nivel'], ['horario', 'Horario'], ['profesor', 'Profesor a cargo'], ['alumno', 'Alumno'], ['curso', 'Curso']],
            filas.map((x) => ({ ...x, nivel_grupo: x.nivel_grupo || 'Sin nivel', horario: x.dia_semana ? describirHorario(x) : 'Sin horario' })))], { ...f, ...p });
});

// ---------------------------------------------------------------------------------------------
// 9. Alumnos por recorrido de transporte: las asignaciones del administrador y las inscripciones del mes
// ---------------------------------------------------------------------------------------------
exports.alumnosPorRecorrido = manejar('alumnos-por-recorrido', async (req) => {
    const f = leerFiltros(req.query, ['ruta_id']);
    const p = leerPeriodo(req.query);
    const r = await db.query(
        `WITH origen AS (
             SELECT ta.ruta_id, ta.alumno_id, ta.punto_encuentro, 'Asignación' AS origen, 1 AS prioridad
             FROM transporte_asignaciones ta
             UNION ALL
             SELECT s.ruta_id, i.alumno_id, NULL, 'Inscripción del mes', 2
             FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Transporte'
             WHERE i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
         ), unico AS (
             SELECT DISTINCT ON (ruta_id, alumno_id) ruta_id, alumno_id, punto_encuentro, origen FROM origen ORDER BY ruta_id, alumno_id, prioridad
         )
         SELECT r.nombre_ruta AS recorrido, COALESCE(r.chofer_nombre, '-') AS chofer, ${ALUMNO_NOMBRE} AS alumno,
                COALESCE(c.division, 'Sin curso') AS curso, COALESCE(n.nombre, 'Sin curso') AS nivel,
                COALESCE(u.punto_encuentro, '-') AS punto, u.origen
         FROM unico u JOIN transporte_rutas r ON r.id = u.ruta_id JOIN alumnos a ON a.id = u.alumno_id AND a.estado = 'Activo'
         LEFT JOIN cursos c ON c.id = a.curso_id LEFT JOIN niveles n ON n.id = c.nivel_id
         WHERE $3::int IS NULL OR r.id = $3
         ORDER BY r.nombre_ruta, a.apellido, a.nombre`, [p.mes, p.anio, f.ruta_id]
    );
    return reporte(`Listado de alumnos por recorrido de transporte (${p.mes}/${p.anio})`,
        [seccion('Alumnos', [['recorrido', 'Recorrido'], ['chofer', 'Chofer'], ['alumno', 'Alumno'], ['nivel', 'Nivel educativo'], ['curso', 'Curso'], ['punto', 'Punto de encuentro'], ['origen', 'Origen']], r.rows)], { ...f, ...p });
});
