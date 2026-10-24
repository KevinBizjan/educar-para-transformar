const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { verifyToken } = authMiddleware;

router.post('/registro', authController.registroFamiliar);
router.post('/login', authController.login);
router.get('/me', verifyToken, authController.getMe);
router.post('/refresh', verifyToken, authController.refresh);
router.post('/change-password', verifyToken, authController.changePassword);
router.get('/padres', verifyToken, authController.getPadres);

// Gestión de usuarios y roles (solo admin)
router.get('/users', authMiddleware(['admin']), authController.getUsers);
router.post('/users', authMiddleware(['admin']), authController.createUser);
router.put('/users/:id/rol', authMiddleware(['admin']), authController.updateUserRol);
router.delete('/users/:id', authMiddleware(['admin']), authController.deleteUser);

module.exports = router;
