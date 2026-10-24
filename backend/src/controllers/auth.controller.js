const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
require('dotenv').config();

const { NOMBRE_REGEX, esNombreValido, esEmailValido, validarPassword } = require('../utils/validators');
const RolFactory = require('../patterns/rolFactory');

const ES_VIOLACION_UNIQUE = (err) => err.code === '23505';

// Sesión: el token dura 30 min (RNF04) y se puede renovar mientras haya actividad, pero una
// sesión no puede superar SESION_MAX_SEGUNDOS desde el login (claim auth_time).
const SESION_MAX_SEGUNDOS = 12 * 60 * 60;
const JWT_SECRETO = () => process.env.JWT_SECRET || 'educar_jwt_secret_dev_key_2026';

const firmarToken = (user, authTime = Math.floor(Date.now() / 1000)) => jwt.sign(
    { id: user.id, username: user.username, rol: user.rol, auth_time: authTime },
    JWT_SECRETO(),
    { expiresIn: '30m' }
);
const datosPublicos = (user) => ({ id: user.id, username: user.username, nombre: user.nombre, rol: user.rol });

// Registro de cuenta familiar (rol "padre").
// El usuario se registra con su correo y una contraseña. El correo se usa
// como nombre de usuario para iniciar sesión. Luego, desde su panel, podrá
// vincular el legajo de su hijo ya creado por la institución.
exports.registroFamiliar = async (req, res) => {
    const nombre = (req.body.nombre || '').trim().replace(/\s+/g, ' ');
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    // Validaciones básicas de entrada
    if (!nombre || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }
    if (!NOMBRE_REGEX.test(nombre)) {
        return res.status(400).json({ message: 'El nombre solo puede contener letras (sin números ni símbolos)' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'El correo electrónico no es válido' });
    }
    const pwError = validarPassword(password);
    if (pwError) {
        return res.status(400).json({ message: pwError });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // El rol siempre es "padre": no se toma del cliente.
    const rolPadre = RolFactory.crear('padre');
    try {
        const result = await db.query(
            `INSERT INTO users (username, password, nombre, rol) VALUES ($1, $2, $3, $4) RETURNING id`,
            [email, hashedPassword, nombre, rolPadre.nombre]
        );
        res.status(201).json({ message: 'Cuenta creada con éxito', userId: result.rows[0].id });
    } catch (err) {
        if (ES_VIOLACION_UNIQUE(err)) {
            return res.status(400).json({ message: 'Ya existe una cuenta con ese correo' });
        }
        res.status(500).json({ message: 'Error al registrar usuario', error: err.message });
    }
};

exports.login = async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    const { password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Usuario y contraseña requeridos' });
    }

    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        res.json({ token: firmarToken(user), user: datosPublicos(user) });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor', error: err.message });
    }
};

// Renueva el token de una sesión ACTIVA (la app móvil lo llama mientras se usa). Devuelve un
// token nuevo con el rol actual de la base, no el del token anterior.
exports.refresh = async (req, res) => {
    const inicioSesion = req.user.auth_time || req.user.iat;
    if (Math.floor(Date.now() / 1000) - inicioSesion > SESION_MAX_SEGUNDOS) {
        return res.status(401).json({ message: 'La sesión llegó a su duración máxima. Iniciá sesión nuevamente.' });
    }
    try {
        const result = await db.query('SELECT id, username, nombre, rol FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ message: 'La cuenta ya no existe. Iniciá sesión nuevamente.' });
        }
        res.json({ token: firmarToken(user, inicioSesion), user: datosPublicos(user) });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// Cambio de contraseña del usuario autenticado. Pide la contraseña actual y aplica las mismas
// reglas que el registro. Una contraseña actual incorrecta responde 400 (no 401) para que los
// clientes no lo confundan con una sesión vencida.
exports.changePassword = async (req, res) => {
    const actual = req.body.password_actual || '';
    const nueva = req.body.password_nueva || '';

    if (!actual || !nueva) {
        return res.status(400).json({ message: 'La contraseña actual y la nueva son obligatorias' });
    }
    const error = validarPassword(nueva);
    if (error) {
        return res.status(400).json({ message: error });
    }
    if (actual === nueva) {
        return res.status(400).json({ message: 'La contraseña nueva debe ser distinta de la actual' });
    }

    try {
        const result = await db.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ message: 'La cuenta ya no existe. Iniciá sesión nuevamente.' });
        }
        if (!(await bcrypt.compare(actual, user.password))) {
            return res.status(400).json({ message: 'La contraseña actual no es correcta' });
        }
        const hash = await bcrypt.hash(nueva, 10);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);
        res.json({ message: 'Contraseña actualizada correctamente' });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getMe = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, username, nombre, rol, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error al obtener datos del usuario' });
    }
};

exports.getPadres = async (req, res) => {
    try {
        const result = await db.query(`SELECT id, nombre, username FROM users WHERE rol = 'padre' ORDER BY nombre`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- GESTIÓN DE USUARIOS Y ROLES (solo admin) ---
exports.getUsers = async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, nombre, rol, created_at FROM users ORDER BY rol, nombre');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Crea un usuario con el rol elegido por el administrador (lista desplegable en el front).
exports.createUser = async (req, res) => {
    const nombre = (req.body.nombre || '').trim().replace(/\s+/g, ' ');
    const username = (req.body.username || '').trim().toLowerCase();
    const password = req.body.password || '';
    const rol = (req.body.rol || '').trim();

    if (!nombre || !username || !password || !rol) {
        return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }
    if (!NOMBRE_REGEX.test(nombre)) {
        return res.status(400).json({ message: 'El nombre solo puede contener letras (sin números ni símbolos)' });
    }
    if (!RolFactory.esValido(rol)) {
        return res.status(400).json({ message: 'Rol inválido' });
    }
    const pwError = validarPassword(password);
    if (pwError) {
        return res.status(400).json({ message: pwError });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        const result = await db.query(
            `INSERT INTO users (username, password, nombre, rol) VALUES ($1, $2, $3, $4) RETURNING id`,
            [username, hashedPassword, nombre, rol]
        );
        res.status(201).json({ message: 'Usuario creado con éxito', id: result.rows[0].id });
    } catch (err) {
        if (ES_VIOLACION_UNIQUE(err)) {
            return res.status(400).json({ message: 'Ya existe un usuario con ese nombre de usuario/correo' });
        }
        res.status(500).json({ message: 'Error al crear usuario', error: err.message });
    }
};

// Cambia el rol de un usuario existente (restricción de accesos).
exports.updateUserRol = async (req, res) => {
    const { id } = req.params;
    const rol = (req.body.rol || '').trim();
    if (!RolFactory.esValido(rol)) {
        return res.status(400).json({ message: 'Rol inválido' });
    }
    // Evita que el admin se quite a sí mismo el rol de admin y quede sin acceso.
    if (parseInt(id) === req.user.id && rol !== 'admin') {
        return res.status(400).json({ message: 'No podés cambiar tu propio rol de administrador' });
    }
    try {
        const result = await db.query('UPDATE users SET rol = $1 WHERE id = $2', [rol, id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.json({ message: 'Rol actualizado correctamente' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ message: 'No podés eliminar tu propia cuenta' });
    }
    try {
        const result = await db.query('DELETE FROM users WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.json({ message: 'Usuario eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
