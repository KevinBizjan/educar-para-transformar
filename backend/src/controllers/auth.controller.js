const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { responderErrorInterno } = require('../utils/errores');
require('dotenv').config();

const { NOMBRE_REGEX, esNombreValido, esEmailValido, validarPassword } = require('../utils/validators');
const RolFactory = require('../patterns/rolFactory');
const { responderErrorDeBorrado } = require('../utils/borrado');
const { esCorreo } = require('../utils/correos');
const { obtenerProveedor } = require('../services/correo');
const rec = require('../utils/recuperacion');

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
        responderErrorInterno(res, err);
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
        responderErrorInterno(res, err);
    }
};

// --- Recuperación de contraseña por correo (rutas públicas) ---
// Pedir el código: siempre se responde lo mismo, exista o no la cuenta, para no revelar quién la tiene.
exports.pedirCodigoPassword = async (req, res) => {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    if (!usuario) return res.status(400).json({ message: 'Escribí tu correo' });
    const proveedor = obtenerProveedor();
    if (!proveedor) return res.status(503).json({ message: 'La recuperación por correo no está disponible por ahora. Pedí el cambio a la institución.' });

    try {
        // Solo las cuentas cuyo usuario es un correo (las familias) pueden recibir el código
        const user = esCorreo(usuario) ? (await db.query('SELECT id, nombre, username FROM users WHERE username = $1', [usuario])).rows[0] : null;
        if (user) {
            const previo = (await db.query('SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - creado_en))::float AS segundos FROM recuperaciones_password WHERE user_id = $1', [user.id])).rows[0];
            if (!previo || !rec.debeEsperar(previo.segundos)) {
                const codigo = rec.crearCodigo();
                const huella = rec.huellaDeCodigo(user.id, codigo, process.env.JWT_SECRET);
                await db.query(
                    `INSERT INTO recuperaciones_password (user_id, huella, vence_en, intentos, usado, creado_en)
                     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 || ' minutes')::interval, 0, FALSE, CURRENT_TIMESTAMP)
                     ON CONFLICT (user_id) DO UPDATE SET huella = EXCLUDED.huella, vence_en = EXCLUDED.vence_en, intentos = 0, usado = FALSE, creado_en = CURRENT_TIMESTAMP`,
                    [user.id, huella, String(rec.MINUTOS_VIGENCIA)]
                );
                const correo = rec.armarCorreoCodigo({ nombre: user.nombre, codigo });
                try {
                    await proveedor.enviar({ para: user.username, asunto: correo.asunto, html: correo.html, texto: correo.texto });
                } catch (err) {
                    // El usuario no debe enterarse (se revelaría que la cuenta existe); queda en el log del servidor
                    console.error('No se pudo enviar el código de recuperación:', err.message);
                }
            }
        }
        res.json({ message: rec.MENSAJE_PEDIDO });
    } catch (err) {
        responderErrorInterno(res, err);
    }
};

// Cambiar la contraseña con el código. Todo en una transacción: el código se consume una sola vez.
exports.restablecerPassword = async (req, res) => {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const codigo = String(req.body.codigo || '').trim();
    const password = req.body.password || '';
    if (!usuario || !codigo || !password) return res.status(400).json({ message: 'Correo, código y contraseña nueva son obligatorios' });
    if (!rec.formatoDeCodigo(codigo)) return res.status(400).json({ message: `El código tiene ${rec.LARGO_CODIGO} dígitos` });
    const errorPassword = validarPassword(password);
    if (errorPassword) return res.status(400).json({ message: errorPassword });

    let cliente;
    try {
        cliente = await db.getClient();
        await cliente.query('BEGIN');
        const user = (await cliente.query('SELECT id FROM users WHERE username = $1', [usuario])).rows[0];
        const guardado = user ? (await cliente.query('SELECT id, huella, (vence_en <= CURRENT_TIMESTAMP) AS vencido, intentos, usado FROM recuperaciones_password WHERE user_id = $1 FOR UPDATE', [user.id])).rows[0] : null;
        if (!guardado || rec.estadoDeCodigo(guardado) !== 'vigente') {
            await cliente.query('ROLLBACK');
            return res.status(400).json({ message: rec.MENSAJE_CODIGO_INVALIDO });
        }
        if (!rec.huellasIguales(guardado.huella, rec.huellaDeCodigo(user.id, codigo, process.env.JWT_SECRET))) {
            await cliente.query('UPDATE recuperaciones_password SET intentos = intentos + 1 WHERE id = $1', [guardado.id]);
            await cliente.query('COMMIT'); // el intento fallido se cuenta aunque no se cambie nada
            return res.status(400).json({ message: rec.MENSAJE_CODIGO_INVALIDO });
        }
        await cliente.query('UPDATE users SET password = $2 WHERE id = $1', [user.id, await bcrypt.hash(password, 10)]);
        await cliente.query('UPDATE recuperaciones_password SET usado = TRUE WHERE id = $1', [guardado.id]);
        await cliente.query('COMMIT');
        res.json({ message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
    } catch (err) {
        if (cliente) await cliente.query('ROLLBACK').catch(() => {});
        responderErrorInterno(res, err);
    } finally {
        if (cliente) cliente.release();
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
        responderErrorInterno(res, err);
    }
};

// --- GESTIÓN DE USUARIOS Y ROLES (solo admin) ---
exports.getUsers = async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, nombre, rol, created_at FROM users ORDER BY rol, nombre');
        res.json(result.rows);
    } catch (err) {
        responderErrorInterno(res, err);
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
        responderErrorInterno(res, err);
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
        responderErrorInterno(res, err);
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
        responderErrorDeBorrado(res, err, 'la cuenta');
    }
};
