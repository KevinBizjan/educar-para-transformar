const express = require('express');
const router = express.Router();
const controller = require('../controllers/cuentas.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Cuenta de la familia en la app móvil: solo el padre/tutor.
router.get('/cuotas', authMiddleware(['padre']), controller.getCuotas);

module.exports = router;
