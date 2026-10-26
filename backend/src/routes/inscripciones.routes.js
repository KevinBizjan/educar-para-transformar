const express = require('express');
const router = express.Router();
const controller = require('../controllers/inscripciones.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// La familia gestiona los tres tipos de servicio; el alumno, solo sus propios deportes (lo controla el controlador).
const familia = authMiddleware(['padre', 'admin', 'alumno']);

// Pantalla "Mis hijos" de la app: hijos, servicios del mes, comedor y saldo (solo padres)
router.get('/resumen-familia', authMiddleware(['padre']), controller.getResumenFamilia);

// Catálogo del mes con cupos disponibles, e inscripciones de un hijo
router.get('/catalogo', familia, controller.getCatalogo);
router.get('/alumno/:alumno_id', familia, controller.getInscripcionesAlumno);

// Inscribir y dar de baja
router.post('/', familia, controller.inscribir);
router.delete('/:id', familia, controller.darDeBaja);

// Administración del catálogo de servicios
router.get('/servicios', authMiddleware(['admin']), controller.listarServicios);
router.post('/servicios', authMiddleware(['admin']), controller.crearServicio);
router.patch('/servicios/:id', authMiddleware(['admin']), controller.actualizarServicio);

module.exports = router;
