const express = require('express');
const router = express.Router();
const serviciosController = require('../controllers/servicios.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Rutas protegidas
router.post('/comedor/asistencia', authMiddleware(['admin', 'docente']), serviciosController.registrarAsistenciaComedor);

router.get('/transporte/rutas', authMiddleware(['admin']), serviciosController.getRutasTransporte);
router.post('/transporte/rutas', authMiddleware(['admin']), serviciosController.createRutaTransporte);
router.delete('/transporte/rutas/:id', authMiddleware(['admin']), serviciosController.deleteRutaTransporte);
router.post('/transporte/asignar', authMiddleware(['admin']), serviciosController.asignarAlumnoTransporte);
router.get('/transporte/asignaciones', authMiddleware(['admin']), serviciosController.getAsignacionesTransporte);
router.delete('/transporte/asignaciones/:id', authMiddleware(['admin']), serviciosController.quitarAsignacionTransporte);

router.get('/instalaciones', authMiddleware(['admin', 'docente']), serviciosController.getInstalaciones);
router.post('/instalaciones/reservar', authMiddleware(['admin', 'docente']), serviciosController.reservarInstalacion);

router.post('/enfermeria/incidencia', authMiddleware(['admin', 'docente']), serviciosController.registrarIncidenciaEnfermeria);

module.exports = router;
