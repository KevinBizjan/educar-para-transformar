const express = require('express');
const router = express.Router();
const controller = require('../controllers/cuentas.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Cuenta de la familia en la app móvil: solo el padre/tutor.
const padre = authMiddleware(['padre']);

router.get('/cuotas', padre, controller.getCuotas);

// Pagar por transferencia bancaria (HU7): lo que se puede elegir y las facturas consolidadas
router.get('/pagables', padre, controller.getPagables);
router.post('/facturas', padre, controller.crearFactura);
router.get('/facturas', padre, controller.listarFacturas);
router.get('/facturas/:id', padre, controller.getFactura);

module.exports = router;
