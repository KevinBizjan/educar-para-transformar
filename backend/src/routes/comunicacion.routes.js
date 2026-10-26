const express = require('express');
const router = express.Router();
const comunicacionController = require('../controllers/comunicacion.controller');
const reportesController = require('../controllers/reportes.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Rutas protegidas
router.get('/notificaciones', authMiddleware(['admin', 'docente', 'alumno', 'padre']), comunicacionController.getNotificaciones);
router.post('/notificaciones', authMiddleware(['admin', 'docente']), comunicacionController.crearNotificacion);

router.get('/actividades-extra', comunicacionController.getActividadesExtra);

router.get('/reportes/stats', authMiddleware(['admin']), reportesController.getEstadisticasGenerales);
router.get('/reportes/academico', authMiddleware(['admin']), reportesController.getReporteAcademico);
router.get('/reportes/financiero', authMiddleware(['admin']), reportesController.getReporteFinanciero);

module.exports = router;
