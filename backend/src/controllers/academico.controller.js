const db = require('../config/database');

const { NOMBRE_REGEX, esNombreValido, esEmailValido } = require('../utils/validators');
const { docenteDeCuenta } = require('../services/vinculos.service');
const { leerPeriodo, periodoDeFecha } = require('../utils/inscripciones');
const { legajoAlumnoSql } = require('../utils/reportes');
const { actividadPorId, inscriptosDeDeporte, estaInscriptoEnDeporte } = require('../services/actividades.service');

const ESTADOS_ALUMNO = ['Activo', 'Inactivo', 'Egresado'];

// --- NIVELES ---
exports.getNiveles = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM niveles');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createNivel = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ message: "El nombre del nivel es obligatorio" });
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre del nivel solo puede contener letras (sin números ni símbolos)" });
    try {
        const result = await db.query('INSERT INTO niveles (nombre) VALUES ($1) RETURNING id', [nombre]);
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.updateNivel = async (req, res) => {
    const { id } = req.params;
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ message: "El nombre del nivel es obligatorio" });
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre del nivel solo puede contener letras (sin números ni símbolos)" });
    try {
        const result = await db.query('UPDATE niveles SET nombre = $1 WHERE id = $2', [nombre, id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Nivel no encontrado" });
        res.json({ message: "Nivel actualizado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Baja de nivel: se impide si tiene cursos asociados, para no dejar datos huérfanos.
exports.deleteNivel = async (req, res) => {
    const { id } = req.params;
    try {
        const countResult = await db.query('SELECT COUNT(*) as total FROM cursos WHERE nivel_id = $1', [id]);
        if (countResult.rows[0].total > 0) {
            return res.status(400).json({ message: "No se puede eliminar: el nivel tiene cursos/divisiones asociados" });
        }
        const deleteResult = await db.query('DELETE FROM niveles WHERE id = $1', [id]);
        if (deleteResult.rowCount === 0) return res.status(404).json({ message: "Nivel no encontrado" });
        res.json({ message: "Nivel eliminado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- AULAS ---
exports.getAulas = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM aulas');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createAula = async (req, res) => {
    const { nombre, capacidad } = req.body;
    if (!nombre || capacidad === undefined || capacidad === null || capacidad === '') {
        return res.status(400).json({ message: "Campos obligatorios" });
    }
    const capacidadNum = Number(capacidad);
    if (!Number.isInteger(capacidadNum) || capacidadNum <= 0) {
        return res.status(400).json({ message: "La capacidad debe ser un número entero mayor a 0" });
    }
    try {
        const result = await db.query('INSERT INTO aulas (nombre, capacidad) VALUES ($1, $2) RETURNING id', [nombre, capacidadNum]);
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- CURSOS ---
exports.getCursos = async (req, res) => {
    const query = `
        SELECT cursos.*, niveles.nombre as nivel_nombre
        FROM cursos
        JOIN niveles ON cursos.nivel_id = niveles.id
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createCurso = async (req, res) => {
    const { nivel_id, division, cupo } = req.body;
    if (!nivel_id || !division || cupo === undefined || cupo === null || cupo === '') {
        return res.status(400).json({ message: "Campos obligatorios" });
    }
    const cupoNum = Number(cupo);
    if (!Number.isInteger(cupoNum) || cupoNum <= 0) {
        return res.status(400).json({ message: "El cupo debe ser un número entero mayor a 0" });
    }
    const divisionLimpia = String(division).trim();
    if (!divisionLimpia) return res.status(400).json({ message: "Campos obligatorios" });
    try {
        const nivel = await db.query('SELECT id FROM niveles WHERE id = $1', [nivel_id]);
        if (!nivel.rows[0]) return res.status(404).json({ message: "El nivel no existe" });
        const repetido = await db.query('SELECT 1 FROM cursos WHERE nivel_id = $1 AND LOWER(division) = LOWER($2)', [nivel_id, divisionLimpia]);
        if (repetido.rowCount > 0) return res.status(409).json({ message: "Ya existe un curso con esa división en este nivel" });
        const result = await db.query('INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, $3) RETURNING id', [nivel_id, divisionLimpia, cupoNum]);
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: "Ya existe un curso con esa división en este nivel" });
        res.status(500).json({ message: err.message });
    }
};

// --- ALUMNOS (Legajos) ---
// Un docente con la cuenta vinculada a su legajo solo ve a los alumnos de los cursos donde dicta clase
// (según los horarios cargados). Si la cuenta aún no está vinculada se mantiene la lista completa,
// para no dejar sin pantalla a quien todavía no fue asociado por la Dirección.
exports.getAlumnos = async (req, res) => {
    let filtro = '';
    const params = [];
    try {
        if (req.user.rol === 'docente') {
            const docenteId = await docenteDeCuenta(req.user.id);
            if (docenteId) {
                filtro = `WHERE alumnos.curso_id IN (
                    SELECT m.curso_id FROM horarios h JOIN materias m ON m.id = h.materia_id WHERE h.docente_id = $1)`;
                params.push(docenteId);
            }
        }
        const result = await db.query(`
            SELECT alumnos.*, ${legajoAlumnoSql('alumnos.id')} AS legajo, cursos.division, niveles.nombre as nivel_nombre
            FROM alumnos
            LEFT JOIN cursos ON alumnos.curso_id = cursos.id
            LEFT JOIN niveles ON cursos.nivel_id = niveles.id
            ${filtro}
        `, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createAlumno = async (req, res) => {
    const { nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id } = req.body;
    const domicilio = (req.body.domicilio || '').trim();
    const telefono = (req.body.telefono || '').trim();
    const email = (req.body.email || '').trim();
    const estado = (req.body.estado || 'Activo').trim();

    if (!nombre || !apellido || !dni || !fecha_nacimiento || !domicilio || !telefono || !email) {
        return res.status(400).json({ message: "Nombre, Apellido, DNI, Fecha de Nacimiento, Domicilio, Teléfono y Correo son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(String(nombre).trim()) || !NOMBRE_REGEX.test(String(apellido).trim())) {
        return res.status(400).json({ message: "Nombre y apellido solo pueden contener letras (sin números ni símbolos)" });
    }
    if (!/^\d+$/.test(String(dni).trim())) {
        return res.status(400).json({ message: "El DNI debe ser numérico (sin puntos ni letras)" });
    }
    if (!esEmailValido(email)) {
        return res.status(400).json({ message: "El correo electrónico no tiene un formato válido" });
    }
    if (!ESTADOS_ALUMNO.includes(estado)) {
        return res.status(400).json({ message: "Estado de alumno inválido" });
    }

    try {
        // Validar cupo si se asigna curso
        if (curso_id) {
            const cursoResult = await db.query(
                'SELECT cupo, (SELECT COUNT(*) FROM alumnos WHERE curso_id = $1) as inscriptos FROM cursos WHERE id = $1',
                [curso_id]
            );
            const curso = cursoResult.rows[0];
            if (!curso) return res.status(404).json({ message: "Curso no encontrado" });
            if (curso.inscriptos >= curso.cupo) return res.status(400).json({ message: "No hay vacantes disponibles en este curso" });
        }

        const result = await db.query(
            `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id, domicilio, telefono, email, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [nombre, apellido, dni, fecha_nacimiento, curso_id || null, tutor_id || null, domicilio, telefono, email, estado]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.updateAlumno = async (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, dni, fecha_nacimiento, curso_id, tutor_id } = req.body;
    const domicilio = (req.body.domicilio || '').trim();
    const telefono = (req.body.telefono || '').trim();
    const email = (req.body.email || '').trim();
    const estado = (req.body.estado || 'Activo').trim();

    if (!nombre || !apellido || !dni || !fecha_nacimiento || !domicilio || !telefono || !email) {
        return res.status(400).json({ message: "Nombre, Apellido, DNI, Fecha de Nacimiento, Domicilio, Teléfono y Correo son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(String(nombre).trim()) || !NOMBRE_REGEX.test(String(apellido).trim())) {
        return res.status(400).json({ message: "Nombre y apellido solo pueden contener letras (sin números ni símbolos)" });
    }
    if (!/^\d+$/.test(String(dni).trim())) {
        return res.status(400).json({ message: "El DNI debe ser numérico (sin puntos ni letras)" });
    }
    if (!esEmailValido(email)) {
        return res.status(400).json({ message: "El correo electrónico no tiene un formato válido" });
    }
    if (!ESTADOS_ALUMNO.includes(estado)) {
        return res.status(400).json({ message: "Estado de alumno inválido" });
    }

    const query = `
        UPDATE alumnos
        SET nombre = $1, apellido = $2, dni = $3, fecha_nacimiento = $4, curso_id = $5, tutor_id = $6,
            domicilio = $7, telefono = $8, email = $9, estado = $10
        WHERE id = $11
    `;
    try {
        const result = await db.query(query, [nombre, apellido, dni, fecha_nacimiento, curso_id || null, tutor_id || null, domicilio, telefono, email, estado, id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Alumno no encontrado" });
        res.json({ message: "Alumno actualizado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- MATERIAS ---
// Devuelve las materias con el curso al que pertenecen (nivel y división).
// Se agregan campos extra por JOIN; los existentes (id, nombre, curso_id) se mantienen.
// Igual que con los alumnos: un docente vinculado ve solo las materias que dicta.
exports.getMaterias = async (req, res) => {
    let filtro = '';
    const params = [];
    try {
        if (req.user.rol === 'docente') {
            const docenteId = await docenteDeCuenta(req.user.id);
            if (docenteId) {
                filtro = 'WHERE materias.id IN (SELECT h.materia_id FROM horarios h WHERE h.docente_id = $1)';
                params.push(docenteId);
            }
        }
        const result = await db.query(`
            SELECT materias.*, niveles.nombre as nivel_nombre, cursos.division
            FROM materias
            LEFT JOIN cursos ON materias.curso_id = cursos.id
            LEFT JOIN niveles ON cursos.nivel_id = niveles.id
            ${filtro}
            ORDER BY niveles.nombre, cursos.division, materias.nombre
        `, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Crea una materia asociada a un curso. Como el alumno pertenece a un curso,
// automáticamente "cursa" las materias de ese curso (modelo por curso, no por alumno).
exports.createMateria = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    const { curso_id } = req.body;
    if (!nombre || !curso_id) {
        return res.status(400).json({ message: "Nombre y curso son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre de la materia solo puede contener letras (sin números ni símbolos)" });
    try {
        const curso = await db.query('SELECT id FROM cursos WHERE id = $1', [curso_id]);
        if (!curso.rows[0]) return res.status(404).json({ message: "El curso no existe" });
        const repetida = await db.query('SELECT 1 FROM materias WHERE curso_id = $1 AND LOWER(nombre) = LOWER($2)', [curso_id, nombre]);
        if (repetida.rowCount > 0) return res.status(409).json({ message: "Esa materia ya existe en este curso" });
        const result = await db.query('INSERT INTO materias (nombre, curso_id) VALUES ($1, $2) RETURNING id', [nombre, curso_id]);
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: "Esa materia ya existe en este curso" });
        res.status(500).json({ message: err.message });
    }
};

exports.updateMateria = async (req, res) => {
    const { id } = req.params;
    const nombre = (req.body.nombre || '').trim();
    const { curso_id } = req.body;
    if (!nombre || !curso_id) {
        return res.status(400).json({ message: "Nombre y curso son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre de la materia solo puede contener letras (sin números ni símbolos)" });
    try {
        const result = await db.query('UPDATE materias SET nombre = $1, curso_id = $2 WHERE id = $3', [nombre, curso_id, id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Materia no encontrada" });
        res.json({ message: "Materia actualizada correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteMateria = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM materias WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Materia no encontrada" });
        res.json({ message: "Materia eliminada correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ACTIVIDADES EXTRACURRICULARES ---
// Lista las actividades con la cantidad de inscriptos (para mostrar cupo disponible).
// Los deportes se inscriben por grupo y por mes (sistema de inscripciones a servicios): sus inscriptos son los
// alumnos activos del mes actual. Cultura e Idioma siguen en el sistema anterior. Un docente con la cuenta
// vinculada ve solo los deportes que dicta; las demás actividades las ve completas.
exports.getActividades = async (req, res) => {
    const query = `
        SELECT ae.*,
               CASE WHEN ae.tipo = 'Deporte'
                    THEN (SELECT COUNT(DISTINCT i.alumno_id)::int
                          FROM inscripciones_servicio i
                          JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Deporte' AND s.actividad_id = ae.id
                          WHERE i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
                            AND ($3::int IS NULL OR s.docente_id = $3))
                    ELSE (SELECT COUNT(*)::int FROM inscripciones_extra WHERE actividad_id = ae.id)
               END AS inscriptos
        FROM actividades_extra ae
        WHERE $3::int IS NULL OR ae.tipo <> 'Deporte'
           OR EXISTS (SELECT 1 FROM servicios s WHERE s.tipo = 'Deporte' AND s.actividad_id = ae.id AND s.docente_id = $3)
        ORDER BY ae.tipo, ae.nombre
    `;
    try {
        const { mes, anio } = leerPeriodo({});
        const result = await db.query(query, [mes, anio, await docenteDeLaSesion(req.user)]);
        // El alumno ve acá solo Cultura e Idioma: sus deportes los elige por grupo en el catálogo de deportes.
        res.json(req.user.rol === 'alumno' ? result.rows.filter((a) => a.tipo !== 'Deporte') : result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createActividad = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    const { tipo, horario, cupo_max } = req.body;
    if (!nombre || !tipo || cupo_max === undefined || cupo_max === null || cupo_max === '') {
        return res.status(400).json({ message: "Nombre, tipo y cupo son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre de la actividad solo puede contener letras (sin números ni símbolos)" });
    const cupoNum = Number(cupo_max);
    if (!Number.isInteger(cupoNum) || cupoNum <= 0) {
        return res.status(400).json({ message: "El cupo debe ser un número entero mayor a 0" });
    }
    try {
        const result = await db.query(
            'INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, $2, $3, $4) RETURNING id',
            [nombre, tipo, horario || null, cupoNum]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.updateActividad = async (req, res) => {
    const { id } = req.params;
    const nombre = (req.body.nombre || '').trim();
    const { tipo, horario, cupo_max } = req.body;
    if (!nombre || !tipo || cupo_max === undefined || cupo_max === null || cupo_max === '') {
        return res.status(400).json({ message: "Nombre, tipo y cupo son obligatorios" });
    }
    if (!NOMBRE_REGEX.test(nombre)) return res.status(400).json({ message: "El nombre de la actividad solo puede contener letras (sin números ni símbolos)" });
    const cupoNum = Number(cupo_max);
    if (!Number.isInteger(cupoNum) || cupoNum <= 0) {
        return res.status(400).json({ message: "El cupo debe ser un número entero mayor a 0" });
    }
    try {
        const result = await db.query(
            'UPDATE actividades_extra SET nombre = $1, tipo = $2, horario = $3, cupo_max = $4 WHERE id = $5',
            [nombre, tipo, horario || null, cupoNum, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "Actividad no encontrada" });
        res.json({ message: "Actividad actualizada correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteActividad = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM actividades_extra WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Actividad no encontrada" });
        res.json({ message: "Actividad eliminada correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// El alumno se inscribe a una actividad de Cultura o Idioma. Valida cupo y que no se inscriba dos veces.
// La inscripción se guarda contra el usuario logueado (req.user.id).
// Los deportes ya no se inscriben acá: tienen grupos por nivel, horario y profesor (POST /api/inscripciones).
exports.inscribirActividad = async (req, res) => {
    const actividad_id = parseInt(req.body.actividad_id);
    const alumno_id = req.user.id;
    if (!actividad_id) return res.status(400).json({ message: "Actividad inválida" });

    try {
        const actResult = await db.query('SELECT cupo_max, tipo FROM actividades_extra WHERE id = $1', [actividad_id]);
        const actividad = actResult.rows[0];
        if (!actividad) return res.status(404).json({ message: "La actividad no existe" });
        if (actividad.tipo === 'Deporte') {
            return res.status(409).json({ message: "Los deportes se inscriben por grupo (nivel, horario y profesor) desde la sección Deportes" });
        }

        const countResult = await db.query('SELECT COUNT(*) as total FROM inscripciones_extra WHERE actividad_id = $1', [actividad_id]);
        if (countResult.rows[0].total >= actividad.cupo_max) {
            return res.status(400).json({ message: "No hay cupos disponibles en esta actividad" });
        }

        const existeResult = await db.query(
            'SELECT id FROM inscripciones_extra WHERE actividad_id = $1 AND alumno_id = $2',
            [actividad_id, alumno_id]
        );
        if (existeResult.rows[0]) return res.status(400).json({ message: "Ya estás inscripto en esta actividad" });

        const insertResult = await db.query(
            'INSERT INTO inscripciones_extra (alumno_id, actividad_id) VALUES ($1, $2) RETURNING id',
            [alumno_id, actividad_id]
        );
        res.status(201).json({ message: "Inscripción realizada con éxito", id: insertResult.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: "Ya estás inscripto en esta actividad" });
        res.status(500).json({ message: err.message });
    }
};

// Lista las actividades de Cultura e Idioma en las que está inscripto el alumno logueado
// (sus deportes salen del sistema de inscripciones por grupo).
exports.getMisInscripciones = async (req, res) => {
    const query = `
        SELECT inscripciones_extra.id as inscripcion_id, actividades_extra.*
        FROM inscripciones_extra
        JOIN actividades_extra ON inscripciones_extra.actividad_id = actividades_extra.id
        WHERE inscripciones_extra.alumno_id = $1 AND actividades_extra.tipo <> 'Deporte'
        ORDER BY actividades_extra.tipo, actividades_extra.nombre
    `;
    try {
        const result = await db.query(query, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// El alumno cancela su inscripción a una actividad.
exports.desinscribirActividad = async (req, res) => {
    const { actividad_id } = req.params;
    try {
        const result = await db.query(
            'DELETE FROM inscripciones_extra WHERE actividad_id = $1 AND alumno_id = $2',
            [actividad_id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "No estabas inscripto en esta actividad" });
        res.json({ message: "Inscripción cancelada" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- MIS HIJOS (para rol padre) ---
exports.getMisHijos = async (req, res) => {
    const query = `
        SELECT alumnos.*, ${legajoAlumnoSql('alumnos.id')} AS legajo, cursos.division, niveles.nombre as nivel_nombre
        FROM alumnos
        LEFT JOIN cursos ON alumnos.curso_id = cursos.id
        LEFT JOIN niveles ON cursos.nivel_id = niveles.id
        WHERE alumnos.tutor_id = $1
    `;
    try {
        const result = await db.query(query, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Resumen académico de un hijo (rol padre, solo lectura): promedio, asistencia
// y faltas reales calculados desde calificaciones y asistencias. Restringido a
// los alumnos cuyo tutor_id sea el padre logueado.
exports.getResumenHijo = async (req, res) => {
    const alumno_id = parseInt(req.params.alumno_id);
    if (!alumno_id) return res.status(400).json({ message: "Alumno inválido" });

    try {
        const alumnoResult = await db.query('SELECT id FROM alumnos WHERE id = $1 AND tutor_id = $2', [alumno_id, req.user.id]);
        if (!alumnoResult.rows[0]) return res.status(403).json({ message: "No tenés acceso a este alumno" });

        const resumen = { promedio: null, total_clases: 0, presentes: 0, faltas: 0, asistencia_pct: null, calificaciones: [] };

        const [promResult, asistResult, califResult] = await Promise.all([
            db.query('SELECT AVG(nota) AS prom FROM calificaciones WHERE alumno_id = $1', [alumno_id]),
            db.query(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN estado = 'Presente' THEN 1 ELSE 0 END) AS presentes,
                        SUM(CASE WHEN estado = 'Ausente' THEN 1 ELSE 0 END) AS faltas
                 FROM asistencias WHERE alumno_id = $1`,
                [alumno_id]
            ),
            db.query(
                `SELECT materias.nombre AS materia_nombre, c.nota, c.trimestre
                 FROM calificaciones c
                 LEFT JOIN materias ON c.materia_id = materias.id
                 WHERE c.alumno_id = $1
                 ORDER BY materias.nombre, c.trimestre`,
                [alumno_id]
            )
        ]);

        if (promResult.rows[0] && promResult.rows[0].prom != null) {
            resumen.promedio = Math.round(promResult.rows[0].prom * 100) / 100;
        }
        const asist = asistResult.rows[0];
        if (asist) {
            resumen.total_clases = asist.total || 0;
            resumen.presentes = asist.presentes || 0;
            resumen.faltas = asist.faltas || 0;
            resumen.asistencia_pct = asist.total ? Math.round((asist.presentes / asist.total) * 100) : null;
        }
        resumen.calificaciones = califResult.rows;

        res.json(resumen);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- VINCULACIÓN DE HIJOS (para rol padre) ---

// Lista los alumnos que todavía no tienen un tutor asignado,
// para que el padre pueda elegir cuál vincular a su cuenta.
exports.getAlumnosDisponibles = async (req, res) => {
    const query = `
        SELECT id, ${legajoAlumnoSql('id')} AS legajo, nombre, apellido, dni
        FROM alumnos
        WHERE tutor_id IS NULL
        ORDER BY apellido, nombre
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Vincula un alumno disponible a la cuenta del padre que hace la solicitud.
exports.vincularHijo = async (req, res) => {
    const alumno_id = parseInt(req.body.alumno_id);
    if (!alumno_id) return res.status(400).json({ message: "Debe seleccionar un alumno" });

    try {
        // Solo permite vincular si el alumno aún no tiene tutor.
        const result = await db.query(
            'UPDATE alumnos SET tutor_id = $1 WHERE id = $2 AND tutor_id IS NULL',
            [req.user.id, alumno_id]
        );
        if (result.rowCount === 0) {
            return res.status(400).json({ message: "El alumno no existe o ya tiene un tutor asignado" });
        }
        res.json({ message: "Alumno vinculado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Desvincula un hijo de la cuenta del padre (solo si le pertenece).
exports.desvincularHijo = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(
            'UPDATE alumnos SET tutor_id = NULL WHERE id = $1 AND tutor_id = $2',
            [id, req.user.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "No se encontró el alumno vinculado a su cuenta" });
        }
        res.json({ message: "Alumno desvinculado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteAlumno = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM alumnos WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Alumno no encontrado" });
        res.json({ message: "Alumno eliminado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteAula = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM aulas WHERE id = $1', [id]);
        res.json({ message: "Aula eliminada" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Edita la división y el cupo de un curso. El nivel no se cambia (los alumnos y las materias dependen de él).
// El cupo no puede quedar por debajo de los alumnos que ya tiene el curso.
exports.updateCurso = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Curso inválido" });
    const division = String(req.body.division === undefined || req.body.division === null ? '' : req.body.division).trim();
    const cupoNum = Number(req.body.cupo);
    if (!division) return res.status(400).json({ message: "La división es obligatoria" });
    if (!Number.isInteger(cupoNum) || cupoNum <= 0) return res.status(400).json({ message: "El cupo debe ser un número entero mayor a 0" });
    try {
        const curso = (await db.query('SELECT id, nivel_id FROM cursos WHERE id = $1', [id])).rows[0];
        if (!curso) return res.status(404).json({ message: "Curso no encontrado" });
        const { n: alumnos } = (await db.query('SELECT COUNT(*)::int AS n FROM alumnos WHERE curso_id = $1', [id])).rows[0];
        if (cupoNum < alumnos) {
            return res.status(409).json({ message: `El curso ya tiene ${alumnos} ${alumnos === 1 ? 'alumno' : 'alumnos'}: el cupo no puede ser menor` });
        }
        const repetido = await db.query('SELECT 1 FROM cursos WHERE nivel_id = $1 AND LOWER(division) = LOWER($2) AND id <> $3', [curso.nivel_id, division, id]);
        if (repetido.rowCount > 0) return res.status(409).json({ message: "Ya existe un curso con esa división en este nivel" });
        await db.query('UPDATE cursos SET division = $1, cupo = $2 WHERE id = $3', [division, cupoNum, id]);
        res.json({ message: "Curso actualizado" });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: "Ya existe un curso con esa división en este nivel" });
        res.status(500).json({ message: err.message });
    }
};

// No se elimina un curso que todavía tiene alumnos o materias: antes la base lo rechazaba con un error técnico.
exports.deleteCurso = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Curso inválido" });
    try {
        const curso = await db.query('SELECT id FROM cursos WHERE id = $1', [id]);
        if (!curso.rows[0]) return res.status(404).json({ message: "Curso no encontrado" });
        const { alumnos, materias } = (await db.query(
            'SELECT (SELECT COUNT(*)::int FROM alumnos WHERE curso_id = $1) AS alumnos, (SELECT COUNT(*)::int FROM materias WHERE curso_id = $1) AS materias', [id]
        )).rows[0];
        if (alumnos > 0 || materias > 0) {
            const partes = [];
            if (alumnos > 0) partes.push(`${alumnos} ${alumnos === 1 ? 'alumno' : 'alumnos'}`);
            if (materias > 0) partes.push(`${materias} ${materias === 1 ? 'materia' : 'materias'}`);
            return res.status(409).json({ message: `El curso tiene ${partes.join(' y ')}: no se puede eliminar` });
        }
        await db.query('DELETE FROM cursos WHERE id = $1', [id]);
        res.json({ message: "Curso eliminado" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ASISTENCIA & CALIFICACIONES (Docente) ---
const ESTADOS_ASISTENCIA = ['Presente', 'Ausente', 'Tarde'];

const esFechaValida = (fecha) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return false;
    const d = new Date(`${fecha}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
};

// Registra la asistencia de una lista de alumnos para una fecha y, opcionalmente,
// una materia (HU1: "por curso/materia"; sin materia = asistencia general del día).
// Es atómico (todo o nada) y no duplica un día ya cargado: si ya hay registros
// responde 409, y solo los modifica si el docente lo confirma (sobrescribir).
exports.registrarAsistencia = async (req, res) => {
    const { fecha, registros } = req.body;
    const sobrescribir = req.body.sobrescribir === true;
    const materiaId = req.body.materia_id ? Number(req.body.materia_id) : null;

    if (materiaId !== null && (!Number.isInteger(materiaId) || materiaId <= 0)) {
        return res.status(400).json({ message: "La materia es inválida" });
    }

    if (!Array.isArray(registros) || registros.length === 0) {
        return res.status(400).json({ message: "Debe indicar al menos un alumno" });
    }
    if (!esFechaValida(fecha)) {
        return res.status(400).json({ message: "La fecha es inválida (formato AAAA-MM-DD)" });
    }
    // Tolerancia de un día por la diferencia de zona horaria entre cliente y servidor.
    const limite = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (fecha > limite) {
        return res.status(400).json({ message: "No se puede registrar asistencia de una fecha futura" });
    }

    const ids = registros.map(r => Number(r.alumno_id));
    const estados = registros.map(r => r.estado);
    if (ids.some(id => !Number.isInteger(id) || id <= 0) || estados.some(e => !ESTADOS_ASISTENCIA.includes(e))) {
        return res.status(400).json({ message: "Cada registro necesita un alumno válido y un estado (Presente, Ausente o Tarde)" });
    }
    if (new Set(ids).size !== ids.length) {
        return res.status(400).json({ message: "Hay alumnos repetidos en la lista" });
    }

    const yaCargada = materiaId ? "Ya hay asistencia cargada para esta fecha y materia" : "Ya hay asistencia general cargada para esta fecha";

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        if (materiaId) {
            const materia = await client.query('SELECT curso_id FROM materias WHERE id = $1', [materiaId]);
            if (materia.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "La materia no existe" });
            }
            const delCurso = await client.query(
                'SELECT COUNT(*)::int AS n FROM alumnos WHERE id = ANY($1::int[]) AND curso_id = $2',
                [ids, materia.rows[0].curso_id]
            );
            if (delCurso.rows[0].n !== ids.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "Hay alumnos que no pertenecen al curso de la materia elegida" });
            }
        }

        const existentes = await client.query(
            `SELECT alumno_id FROM asistencias
             WHERE fecha = $1 AND alumno_id = ANY($2::int[]) AND COALESCE(materia_id, 0) = COALESCE($3::int, 0)`,
            [fecha, ids, materiaId]
        );
        if (existentes.rowCount > 0 && !sobrescribir) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: yaCargada, existentes: existentes.rowCount });
        }
        const onConflict = sobrescribir
            ? 'ON CONFLICT (alumno_id, fecha, (COALESCE(materia_id, 0))) DO UPDATE SET estado = EXCLUDED.estado'
            : '';
        await client.query(
            `INSERT INTO asistencias (alumno_id, fecha, materia_id, estado)
             SELECT t.alumno_id, $1::date, $4::int, t.estado FROM unnest($2::int[], $3::text[]) AS t(alumno_id, estado)
             ${onConflict}`,
            [fecha, ids, estados, materiaId]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: "Asistencia guardada", guardados: ids.length, modificados: existentes.rowCount });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23503') return res.status(400).json({ message: "Alguno de los alumnos o la materia no existe" });
        if (err.code === '23505') return res.status(409).json({ message: yaCargada });
        res.status(500).json({ message: err.message });
    } finally {
        client.release();
    }
};

exports.cargarCalificacion = async (req, res) => {
    const { alumno_id, materia_id, nota, trimestre } = req.body;
    if (!alumno_id) return res.status(400).json({ message: "Datos incompletos" });
    if (nota === undefined || nota === null || String(nota).trim() === '') {
        return res.status(400).json({ message: "La nota es obligatoria" });
    }
    if (!/^\d+$/.test(String(nota).trim())) {
        return res.status(400).json({ message: "La nota debe ser un número entero (sin decimales, texto ni símbolos)" });
    }
    const notaNum = Number(nota);
    if (notaNum < 1 || notaNum > 10) {
        return res.status(400).json({ message: "La nota debe estar en el rango de 1 a 10" });
    }
    const trim = trimestre || 1;

    try {
        // Buscar si ya existe una nota para este alumno, materia y trimestre
        const existingResult = await db.query(
            'SELECT id FROM calificaciones WHERE alumno_id = $1 AND materia_id = $2 AND trimestre = $3',
            [alumno_id, materia_id, trim]
        );
        const existing = existingResult.rows[0];

        if (existing) {
            // Actualizar la calificación existente
            await db.query('UPDATE calificaciones SET nota = $1 WHERE id = $2', [notaNum, existing.id]);
            res.json({ message: "Calificación actualizada con éxito", id: existing.id });
        } else {
            // Insertar nueva calificación
            const insertResult = await db.query(
                'INSERT INTO calificaciones (alumno_id, materia_id, nota, trimestre) VALUES ($1, $2, $3, $4) RETURNING id',
                [alumno_id, materia_id, notaNum, trim]
            );
            res.status(201).json({ id: insertResult.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Obtiene las calificaciones cargadas para una materia determinada
exports.getCalificacionesMateria = async (req, res) => {
    const { materia_id } = req.params;
    const query = `
        SELECT c.id, c.alumno_id, c.materia_id, c.nota, c.trimestre
        FROM calificaciones c
        WHERE c.materia_id = $1
        ORDER BY c.id DESC
    `;
    try {
        const result = await db.query(query, [materia_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Historial completo de asistencias y notas de un alumno para el docente
exports.getHistorialAlumnoDocente = async (req, res) => {
    const { alumno_id } = req.params;
    const historial = { alumno: null, calificaciones: [], asistencias: [] };

    let alumno;
    try {
        const alumnoResult = await db.query('SELECT id, nombre, apellido, dni FROM alumnos WHERE id = $1', [alumno_id]);
        alumno = alumnoResult.rows[0];
    } catch (err) {
        alumno = null;
    }
    if (!alumno) return res.status(404).json({ message: "Alumno no encontrado" });
    historial.alumno = alumno;

    try {
        const [califResult, asistResult] = await Promise.all([
            db.query(
                `SELECT c.*, materias.nombre AS materia_nombre
                 FROM calificaciones c
                 LEFT JOIN materias ON c.materia_id = materias.id
                 WHERE c.alumno_id = $1
                 ORDER BY materias.nombre, c.trimestre`,
                [alumno_id]
            ),
            db.query(
                `SELECT a.*, m.nombre AS materia_nombre
                 FROM asistencias a
                 LEFT JOIN materias m ON a.materia_id = m.id
                 WHERE a.alumno_id = $1
                 ORDER BY a.fecha DESC, a.id DESC LIMIT 30`,
                [alumno_id]
            )
        ]);
        historial.calificaciones = califResult.rows;
        historial.asistencias = asistResult.rows;
    } catch (err) {
        // Igual que el comportamiento original: si fallan estas consultas, se listan vacías.
    }

    res.json(historial);
};

// --- DOCENTES ---
// La fuente de docentes es la tabla `personal` filtrada por tipo='Docente',
// que es la que gestiona el administrador (alta/baja de personal docente).
exports.getDocentes = async (req, res) => {
    try {
        const result = await db.query(
            "SELECT id, nombre, apellido, dni FROM personal WHERE tipo = 'Docente' ORDER BY apellido, nombre"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- HORARIOS (Asignación Docente + Materia + Aula + Franja horaria) ---
// Lista los horarios con los nombres relacionados para mostrarlos legibles.
exports.getHorarios = async (req, res) => {
    const query = `
        SELECT h.*,
               materias.nombre AS materia_nombre,
               niveles.nombre AS nivel_nombre,
               cursos.division AS division,
               (personal.nombre || ' ' || personal.apellido) AS docente_nombre,
               aulas.nombre AS aula_nombre
        FROM horarios h
        LEFT JOIN materias ON h.materia_id = materias.id
        LEFT JOIN cursos ON materias.curso_id = cursos.id
        LEFT JOIN niveles ON cursos.nivel_id = niveles.id
        LEFT JOIN personal ON h.docente_id = personal.id
        LEFT JOIN aulas ON h.aula_id = aulas.id
        ORDER BY h.dia_semana, h.hora_inicio
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Crea un horario validando que no exista superposición de franja horaria
// para el MISMO docente o la MISMA aula en el mismo día de la semana.
exports.createHorario = async (req, res) => {
    const materia_id = parseInt(req.body.materia_id);
    const docente_id = parseInt(req.body.docente_id);
    const aula_id = parseInt(req.body.aula_id);
    const dia_semana = parseInt(req.body.dia_semana);
    const hora_inicio = (req.body.hora_inicio || '').trim();
    const hora_fin = (req.body.hora_fin || '').trim();

    if (!materia_id || !docente_id || !aula_id || !dia_semana || !hora_inicio || !hora_fin) {
        return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }
    const horaRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!horaRegex.test(hora_inicio) || !horaRegex.test(hora_fin)) {
        return res.status(400).json({ message: "Las horas deben tener formato HH:MM (24h)" });
    }
    if (hora_inicio >= hora_fin) {
        return res.status(400).json({ message: "La hora de inicio debe ser anterior a la hora de fin" });
    }

    // Dos franjas se solapan si: inicio_existente < fin_nuevo AND fin_existente > inicio_nuevo.
    const checkQuery = `
        SELECT (personal.nombre || ' ' || personal.apellido) AS docente_nombre,
               aulas.nombre AS aula_nombre,
               h.docente_id, h.aula_id, h.hora_inicio, h.hora_fin
        FROM horarios h
        LEFT JOIN personal ON h.docente_id = personal.id
        LEFT JOIN aulas ON h.aula_id = aulas.id
        WHERE h.dia_semana = $1
          AND (h.docente_id = $2 OR h.aula_id = $3)
          AND h.hora_inicio < $4
          AND h.hora_fin > $5
        LIMIT 1
    `;
    try {
        const checkResult = await db.query(checkQuery, [dia_semana, docente_id, aula_id, hora_fin, hora_inicio]);
        const conflicto = checkResult.rows[0];
        if (conflicto) {
            const motivo = conflicto.docente_id === docente_id
                ? `el docente ${conflicto.docente_nombre} ya tiene una clase`
                : `el aula ${conflicto.aula_nombre} ya está ocupada`;
            return res.status(400).json({
                message: `Superposición de horario: ${motivo} de ${conflicto.hora_inicio} a ${conflicto.hora_fin} ese día.`
            });
        }

        const result = await db.query(
            'INSERT INTO horarios (materia_id, docente_id, aula_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [materia_id, docente_id, aula_id, dia_semana, hora_inicio, hora_fin]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteHorario = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM horarios WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: "Horario no encontrado" });
        res.json({ message: "Horario eliminado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ASISTENCIA Y NOTAS DE ACTIVIDADES EXTRACURRICULARES (profesores) ---
// Deportes: los inscriptos salen de los grupos del sistema de inscripciones (por mes) y el alumno se identifica
// con su legajo (alumnos.id). Un docente con la cuenta vinculada trabaja solo con los grupos que dicta.
// Cultura e Idioma: las inscripciones (inscripciones_extra.alumno_id) referencian al usuario alumno que se
// inscribió, por eso se obtiene el nombre desde la tabla users.
const docenteDeLaSesion = (usuario) => (usuario.rol === 'docente' ? docenteDeCuenta(usuario.id) : null);
const ESTADOS_ASISTENCIA_ACTIVIDAD = ['Presente', 'Ausente', 'Tarde'];

exports.getInscriptosActividad = async (req, res) => {
    const actividadId = parseInt(req.params.actividad_id);
    if (!actividadId) return res.status(400).json({ message: "Actividad inválida" });
    const { mes, anio, error } = leerPeriodo(req.query);
    if (error) return res.status(400).json({ message: error });

    const query = `
        SELECT ie.alumno_id, users.nombre AS alumno_nombre, ie.fecha_inscripcion,
               (SELECT nota FROM actividad_calificaciones
                 WHERE actividad_id = ie.actividad_id AND alumno_id = ie.alumno_id
                 ORDER BY id DESC LIMIT 1) AS ultima_nota
        FROM inscripciones_extra ie
        JOIN users ON ie.alumno_id = users.id
        WHERE ie.actividad_id = $1
        ORDER BY users.nombre
    `;
    try {
        const actividad = await actividadPorId(actividadId);
        if (!actividad) return res.status(404).json({ message: "La actividad no existe" });
        if (actividad.tipo === 'Deporte') {
            return res.json(await inscriptosDeDeporte(actividadId, mes, anio, await docenteDeLaSesion(req.user)));
        }
        const result = await db.query(query, [actividadId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.registrarAsistenciaActividad = async (req, res) => {
    const { actividad_id, alumno_id, fecha, estado } = req.body;
    if (!actividad_id || !alumno_id || !estado) {
        return res.status(400).json({ message: "Datos incompletos" });
    }
    if (!ESTADOS_ASISTENCIA_ACTIVIDAD.includes(estado)) {
        return res.status(400).json({ message: "Estado inválido" });
    }
    try {
        const actividad = await actividadPorId(parseInt(actividad_id));
        if (!actividad) return res.status(404).json({ message: "La actividad no existe" });

        if (actividad.tipo === 'Deporte') {
            // El alumno tiene que estar inscripto en un grupo de este deporte en el mes de la clase.
            const dia = fecha || new Date().toLocaleDateString('en-CA');
            if (!esFechaValida(dia)) return res.status(400).json({ message: "La fecha no es válida" });
            const { mes, anio } = periodoDeFecha(dia);
            const docenteId = await docenteDeLaSesion(req.user);
            if (!(await estaInscriptoEnDeporte(actividad.id, parseInt(alumno_id), mes, anio, docenteId))) {
                return res.status(409).json({ message: "El alumno no está inscripto en este deporte ese mes" });
            }
            const nueva = await db.query(
                'INSERT INTO actividad_asistencias (actividad_id, legajo_id, fecha, estado) VALUES ($1, $2, $3, $4) RETURNING id',
                [actividad.id, parseInt(alumno_id), dia, estado]
            );
            return res.status(201).json({ id: nueva.rows[0].id });
        }

        const result = await db.query(
            'INSERT INTO actividad_asistencias (actividad_id, alumno_id, fecha, estado) VALUES ($1, $2, $3, $4) RETURNING id',
            [actividad_id, alumno_id, fecha || null, estado]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.cargarCalificacionActividad = async (req, res) => {
    const { actividad_id, alumno_id, nota } = req.body;
    if (!actividad_id || !alumno_id) {
        return res.status(400).json({ message: "Datos incompletos" });
    }
    if (nota === undefined || nota === null || String(nota).trim() === '') {
        return res.status(400).json({ message: "La nota es obligatoria" });
    }
    if (!/^\d+$/.test(String(nota).trim())) {
        return res.status(400).json({ message: "La nota debe ser un número entero (sin decimales, texto ni símbolos)" });
    }
    const notaNum = Number(nota);
    if (notaNum < 1 || notaNum > 10) {
        return res.status(400).json({ message: "La nota debe estar en el rango de 1 a 10" });
    }
    try {
        const actividad = await actividadPorId(parseInt(actividad_id));
        if (!actividad) return res.status(404).json({ message: "La actividad no existe" });

        if (actividad.tipo === 'Deporte') {
            // Solo se califica a quien está inscripto en un grupo de este deporte en el mes actual.
            const { mes, anio } = leerPeriodo({});
            const legajoId = parseInt(alumno_id);
            const docenteId = await docenteDeLaSesion(req.user);
            if (!(await estaInscriptoEnDeporte(actividad.id, legajoId, mes, anio, docenteId))) {
                return res.status(409).json({ message: "El alumno no está inscripto en este deporte este mes" });
            }
            const previa = (await db.query(
                'SELECT id FROM actividad_calificaciones WHERE actividad_id = $1 AND legajo_id = $2', [actividad.id, legajoId]
            )).rows[0];
            if (previa) {
                await db.query('UPDATE actividad_calificaciones SET nota = $1 WHERE id = $2', [notaNum, previa.id]);
                return res.json({ message: "Calificación de actividad actualizada", id: previa.id });
            }
            const nueva = await db.query(
                'INSERT INTO actividad_calificaciones (actividad_id, legajo_id, nota) VALUES ($1, $2, $3) RETURNING id',
                [actividad.id, legajoId, notaNum]
            );
            return res.status(201).json({ id: nueva.rows[0].id });
        }

        const existingResult = await db.query(
            'SELECT id FROM actividad_calificaciones WHERE actividad_id = $1 AND alumno_id = $2',
            [actividad_id, alumno_id]
        );
        const existing = existingResult.rows[0];

        if (existing) {
            await db.query('UPDATE actividad_calificaciones SET nota = $1 WHERE id = $2', [notaNum, existing.id]);
            res.json({ message: "Calificación de actividad actualizada", id: existing.id });
        } else {
            const insertResult = await db.query(
                'INSERT INTO actividad_calificaciones (actividad_id, alumno_id, nota) VALUES ($1, $2, $3) RETURNING id',
                [actividad_id, alumno_id, notaNum]
            );
            res.status(201).json({ id: insertResult.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
