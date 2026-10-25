// Vistas del portal web de docentes y padres (ARTE-2, Sprint C): cada uno ve solo lo suyo.
//  - Docente: sus cursos y horarios (la ficha de su legajo).
//  - Padre: la ficha de cada hijo (profesores por materia, deportes, transporte y comedor) e inscripción
//    del hijo al cursado (curso con vacantes).
const db = require('../config/database');
const { validarMesAnio, ReglaError } = require('../utils/inscripciones');
const { vacantes } = require('../utils/vinculos');
const { fichaAlumno, fichaDocente } = require('../services/fichas.service');
const { docenteDeCuenta } = require('../services/vinculos.service');

const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    res.status(500).json({ message: err.message });
};

// Un padre solo accede a los alumnos de los que es tutor.
const hijoDelPadre = async (consulta, alumnoId, padreId) => {
    const alumno = (await consulta('SELECT id, estado, curso_id FROM alumnos WHERE id = $1 AND tutor_id = $2', [alumnoId, padreId])).rows[0];
    if (!alumno) throw new ReglaError(403, 'No tenés acceso a este alumno');
    return alumno;
};

// --- Docente: sus cursos y horarios ---
exports.misCursos = async (req, res) => {
    try {
        const docenteId = await docenteDeCuenta(req.user.id);
        // Sin vínculo no hay a quién mostrarle: la Dirección debe asociar la cuenta a su legajo.
        if (!docenteId) return res.json({ vinculado: false });
        res.json({ vinculado: true, ficha: await fichaDocente(docenteId) });
    } catch (err) {
        responderError(res, err);
    }
};

// --- Padre: ficha completa de un hijo ---
exports.fichaHijo = async (req, res) => {
    const alumnoId = parseInt(req.params.alumno_id);
    if (!alumnoId) return res.status(400).json({ message: 'Alumno inválido' });
    const hoy = new Date();
    const mes = req.query.mes === undefined ? hoy.getMonth() + 1 : Number(req.query.mes);
    const anio = req.query.anio === undefined ? hoy.getFullYear() : Number(req.query.anio);
    const errorPeriodo = validarMesAnio(mes, anio);
    if (errorPeriodo) return res.status(400).json({ message: errorPeriodo });

    try {
        await hijoDelPadre((t, p) => db.query(t, p), alumnoId, req.user.id);
        res.json(await fichaAlumno(alumnoId, mes, anio));
    } catch (err) {
        responderError(res, err);
    }
};

// --- Padre: cursos a los que puede inscribir a un hijo ---
exports.cursosDisponibles = async (req, res) => {
    try {
        const r = await db.query(
            `SELECT c.id, c.division, c.cupo, n.nombre AS nivel_nombre,
                    (SELECT COUNT(*)::int FROM alumnos a WHERE a.curso_id = c.id) AS inscriptos
             FROM cursos c JOIN niveles n ON n.id = c.nivel_id ORDER BY n.nombre, c.division`
        );
        res.json(r.rows.map((c) => ({ ...c, vacantes: vacantes(c.cupo, c.inscriptos) })));
    } catch (err) {
        responderError(res, err);
    }
};

// --- Padre: inscribir a un hijo al cursado ---
// Solo si el hijo todavía no tiene curso (cambiarlo es una decisión de la Dirección) y el curso tiene vacantes.
// El curso se bloquea durante la operación: dos padres que piden la última vacante a la vez no la superan.
exports.inscribirCurso = async (req, res) => {
    const alumnoId = parseInt(req.params.alumno_id);
    const cursoId = parseInt(req.body.curso_id);
    if (!alumnoId) return res.status(400).json({ message: 'Alumno inválido' });
    if (!cursoId) return res.status(400).json({ message: 'Debe seleccionar un curso' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const consulta = (t, p) => client.query(t, p);

        const alumno = await hijoDelPadre(consulta, alumnoId, req.user.id);
        if (alumno.estado !== 'Activo') throw new ReglaError(409, 'Solo se puede inscribir a un alumno activo');
        if (alumno.curso_id) throw new ReglaError(409, 'El alumno ya está inscripto en un curso. Para cambiarlo, comunicate con la Dirección.');

        const curso = (await consulta('SELECT id, cupo FROM cursos WHERE id = $1 FOR UPDATE', [cursoId])).rows[0];
        if (!curso) throw new ReglaError(404, 'Curso no encontrado');
        const inscriptos = (await consulta('SELECT COUNT(*)::int AS n FROM alumnos WHERE curso_id = $1', [cursoId])).rows[0].n;
        if (vacantes(curso.cupo, inscriptos) === 0) throw new ReglaError(400, 'No hay vacantes disponibles en este curso');

        await consulta('UPDATE alumnos SET curso_id = $1 WHERE id = $2', [cursoId, alumnoId]);
        await client.query('COMMIT');
        res.json({ message: 'Alumno inscripto al curso correctamente', alumno_id: alumnoId, curso_id: cursoId });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        responderError(res, err);
    } finally {
        client.release();
    }
};
