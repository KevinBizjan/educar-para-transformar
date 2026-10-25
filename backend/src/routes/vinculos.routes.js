const express = require('express');
const router = express.Router();
const c = require('../controllers/vinculos.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Vincular cuentas con legajos es solo para el administrador.
router.use(authMiddleware(['admin']));

router.get('/', c.listar);
router.put('/alumnos/:id', c.vincularAlumno);
router.put('/docentes/:id', c.vincularDocente);

module.exports = router;
