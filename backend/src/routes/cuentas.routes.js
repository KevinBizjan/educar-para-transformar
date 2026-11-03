const express = require('express');
const router = express.Router();
const controller = require('../controllers/cuentas.controller');
const comprobantes = require('../controllers/comprobantes.controller');
const historial = require('../controllers/historial.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Cuenta de la familia en la app móvil: solo el padre/tutor.
const padre = authMiddleware(['padre']);

router.get('/cuotas', padre, controller.getCuotas);

// Pagar por transferencia bancaria (HU7): lo que se puede elegir y las facturas consolidadas
router.get('/pagables', padre, controller.getPagables);
router.post('/facturas', padre, controller.crearFactura);
router.get('/facturas', padre, controller.listarFacturas);
router.get('/facturas/:id', padre, controller.getFactura);

// Comprobantes de la transferencia (HU8), guardados en Supabase Storage
router.post('/facturas/:id/comprobantes', padre, comprobantes.subirComprobante);
router.get('/facturas/:id/comprobantes', padre, comprobantes.listarComprobantes);
router.get('/comprobantes/:id/url', padre, comprobantes.urlComprobante);
router.delete('/comprobantes/:id', padre, comprobantes.borrarComprobante);

// Historial de deudas y comprobante consolidado en PDF (HU9). El PDF se abre con un enlace temporal firmado, sin sesión.
router.get('/historial', padre, historial.getHistorial);
router.get('/pdf-enlace', padre, historial.pedirEnlacePdf);
router.get('/pdf/:token', historial.servirPdf);

module.exports = router;
