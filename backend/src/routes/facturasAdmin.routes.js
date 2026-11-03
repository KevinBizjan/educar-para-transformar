const express = require('express');
const router = express.Router();
const controller = require('../controllers/facturasAdmin.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Revisión de facturas por la Dirección (HU9): solo el administrador
const admin = authMiddleware(['admin']);

router.get('/', admin, controller.listar);
router.get('/comprobantes/:id/url', admin, controller.urlComprobante); // antes de '/:id' para que no se confunda
router.get('/:id', admin, controller.detalle);
router.patch('/:id/estado', admin, controller.cambiarEstado);

module.exports = router;
