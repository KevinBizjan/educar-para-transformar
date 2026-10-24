const express = require('express');
const router = express.Router();
const controller = require('../controllers/inscripciones.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const familia = authMiddleware(['padre', 'admin']);

// Catálogo del mes con cupos disponibles, e inscripciones de un hijo
router.get('/catalogo', familia, controller.getCatalogo);
router.get('/alumno/:alumno_id', familia, controller.getInscripcionesAlumno);

// Inscribir y dar de baja
router.post('/', familia, controller.inscribir);
router.delete('/:id', familia, controller.darDeBaja);

// Administración del catálogo de servicios
router.post('/servicios', authMiddleware(['admin']), controller.crearServicio);
router.patch('/servicios/:id', authMiddleware(['admin']), controller.actualizarServicio);

module.exports = router;
