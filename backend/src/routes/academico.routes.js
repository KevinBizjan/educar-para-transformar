const express = require('express');
const router = express.Router();
const academicoController = require('../controllers/academico.controller');
const portalController = require('../controllers/portal.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Rutas protegidas por rol (Admin y Docente)
router.get('/niveles', academicoController.getNiveles);
router.post('/niveles', authMiddleware(['admin']), academicoController.createNivel);
router.put('/niveles/:id', authMiddleware(['admin']), academicoController.updateNivel);
router.delete('/niveles/:id', authMiddleware(['admin']), academicoController.deleteNivel);
router.get('/aulas', academicoController.getAulas);
router.post('/aulas', authMiddleware(['admin']), academicoController.createAula);
router.delete('/aulas/:id', authMiddleware(['admin']), academicoController.deleteAula);

router.get('/cursos', academicoController.getCursos);
router.post('/cursos', authMiddleware(['admin']), academicoController.createCurso);
router.delete('/cursos/:id', authMiddleware(['admin']), academicoController.deleteCurso);

router.get('/alumnos', authMiddleware(['admin', 'docente']), academicoController.getAlumnos);
router.post('/alumnos', authMiddleware(['admin']), academicoController.createAlumno);
router.put('/alumnos/:id', authMiddleware(['admin']), academicoController.updateAlumno);
router.delete('/alumnos/:id', authMiddleware(['admin']), academicoController.deleteAlumno);

router.get('/materias', authMiddleware(['admin', 'docente']), academicoController.getMaterias);
router.post('/materias', authMiddleware(['admin']), academicoController.createMateria);
router.put('/materias/:id', authMiddleware(['admin']), academicoController.updateMateria);
router.delete('/materias/:id', authMiddleware(['admin']), academicoController.deleteMateria);

// Actividades extracurriculares (deportivas/culturales)
router.get('/actividades', authMiddleware(['admin', 'alumno', 'docente']), academicoController.getActividades);
router.post('/actividades', authMiddleware(['admin']), academicoController.createActividad);
router.put('/actividades/:id', authMiddleware(['admin']), academicoController.updateActividad);
router.delete('/actividades/:id', authMiddleware(['admin']), academicoController.deleteActividad);
router.get('/mis-inscripciones', authMiddleware(['alumno']), academicoController.getMisInscripciones);
router.post('/inscribir-actividad', authMiddleware(['alumno']), academicoController.inscribirActividad);
router.delete('/desinscribir-actividad/:actividad_id', authMiddleware(['alumno']), academicoController.desinscribirActividad);
router.get('/mis-hijos', authMiddleware(['padre']), academicoController.getMisHijos);
router.get('/mis-hijos/:alumno_id/resumen', authMiddleware(['padre']), academicoController.getResumenHijo);
router.get('/mis-hijos/:alumno_id/ficha', authMiddleware(['padre']), portalController.fichaHijo);
router.post('/mis-hijos/:alumno_id/inscribir-curso', authMiddleware(['padre']), portalController.inscribirCurso);
router.get('/cursos-disponibles', authMiddleware(['padre']), portalController.cursosDisponibles);
router.get('/mis-cursos', authMiddleware(['docente']), portalController.misCursos);
router.get('/alumnos-disponibles', authMiddleware(['padre']), academicoController.getAlumnosDisponibles);
router.post('/vincular-hijo', authMiddleware(['padre']), academicoController.vincularHijo);
router.delete('/desvincular-hijo/:id', authMiddleware(['padre']), academicoController.desvincularHijo);

router.post('/asistencias', authMiddleware(['docente']), academicoController.registrarAsistencia);
router.post('/calificaciones', authMiddleware(['docente']), academicoController.cargarCalificacion);
router.get('/calificaciones/materia/:materia_id', authMiddleware(['admin', 'docente']), academicoController.getCalificacionesMateria);
router.get('/alumnos/:alumno_id/historial-docente', authMiddleware(['admin', 'docente']), academicoController.getHistorialAlumnoDocente);

// Docentes y Horarios (asignación docente↔materia con validación de superposición)
router.get('/docentes', authMiddleware(['admin', 'docente']), academicoController.getDocentes);
router.get('/horarios', authMiddleware(['admin', 'docente']), academicoController.getHorarios);
router.post('/horarios', authMiddleware(['admin']), academicoController.createHorario);
router.delete('/horarios/:id', authMiddleware(['admin']), academicoController.deleteHorario);

// Asistencia y notas de actividades extracurriculares (profesores de actividades/idiomas)
router.get('/actividades/:actividad_id/inscriptos', authMiddleware(['admin', 'docente']), academicoController.getInscriptosActividad);
router.post('/actividades/asistencia', authMiddleware(['docente']), academicoController.registrarAsistenciaActividad);
router.post('/actividades/calificacion', authMiddleware(['docente']), academicoController.cargarCalificacionActividad);

module.exports = router;
