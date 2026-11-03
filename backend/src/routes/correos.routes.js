const express = require('express');
const router = express.Router();
const controller = require('../controllers/correos.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const [verificarSesion, verificarRol] = authMiddleware(['admin']);

// El disparador diario (GitHub Actions) se identifica con el secreto CRON_SECRET en el encabezado x-cron-secret; sin él,
// hace falta la sesión de un administrador.
const adminOProgramador = (req, res, next) => {
    if (req.headers['x-cron-secret'] !== undefined) {
        if (!controller.secretoValido(req.headers['x-cron-secret'])) return res.status(403).json({ message: 'Secreto del programador inválido' });
        req.cron = true;
        return next();
    }
    return verificarSesion(req, res, (err) => (err ? next(err) : verificarRol(req, res, next)));
};

router.post('/ejecutar', adminOProgramador, controller.ejecutar);
router.get('/', authMiddleware(['admin']), controller.listar);

module.exports = router;
