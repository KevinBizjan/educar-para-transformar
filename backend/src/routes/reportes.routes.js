const express = require('express');
const router = express.Router();
const c = require('../controllers/listados.controller');
const pagos = require('../controllers/reportesPagos.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Los reportes de la Dirección son solo para el administrador.
router.use(authMiddleware(['admin']));

router.get('/', c.getCatalogo);
router.get('/opciones', c.getOpciones);

router.get('/alumno/:id', c.porAlumno);
router.get('/docente/:id', c.porDocente);
router.get('/alumnos-por-curso', c.alumnosPorCurso);
router.get('/alumnos-por-materia', c.alumnosPorMateria);
router.get('/docentes-por-nivel', c.docentesPorNivel);
router.get('/alumnos-por-deporte', c.alumnosPorDeporte);
router.get('/alumnos-por-deporte-y-nivel', c.alumnosPorDeporteYNivel);
router.get('/alumnos-por-deporte-nivel-horario', c.alumnosPorDeporteNivelHorario);
router.get('/alumnos-por-recorrido', c.alumnosPorRecorrido);

// Reportes de pagos (HU11 y HU12)
router.get('/ingresos', pagos.ingresos);
router.get('/pagos-por-alumno', pagos.pagosPorAlumno);
router.get('/pagos-por-deporte', pagos.pagosPorDeporte);
router.get('/pagos-por-recorrido', pagos.pagosPorRecorrido);

module.exports = router;
