const db = require('../config/database');
const PagosFacade = require('../patterns/pagosFacade');

const { NOMBRE_REGEX, esNombreValido, esDniValido, esEmailValido } = require('../utils/validators');

const ESTADOS_PERSONAL = ['Activo', 'Inactivo', 'Licencia'];

// --- PERSONAL ---
exports.getPersonal = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM personal');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Valida los campos comunes a alta y baja de personal. Devuelve un mensaje
// de error (string) o null si todo es válido.
const validarPersonal = ({ nombre, apellido, dni, tipo, email, telefono, especialidad, estado }) => {
    if (!nombre || !apellido || !dni || !tipo || !telefono) return "Nombre, apellido, DNI, tipo y teléfono son obligatorios";
    if (!NOMBRE_REGEX.test(String(nombre).trim()) || !NOMBRE_REGEX.test(String(apellido).trim())) {
        return "Nombre y apellido solo pueden contener letras (sin números ni símbolos)";
    }
    if (!/^\d+$/.test(String(dni).trim())) return "El DNI debe ser numérico (sin puntos ni letras)";
    if (email && !esEmailValido(email)) return "El correo electrónico no tiene un formato válido";
    if (tipo === 'Docente' && !String(especialidad || '').trim()) return "La especialidad es obligatoria para el personal docente";
    if (estado && !ESTADOS_PERSONAL.includes(estado)) return "Estado de personal inválido";
    return null;
};

exports.createPersonal = async (req, res) => {
    const { nombre, apellido, dni, tipo, email } = req.body;
    const telefono = (req.body.telefono || '').trim();
    const especialidad = (req.body.especialidad || '').trim();
    const estado = (req.body.estado || 'Activo').trim();

    const error = validarPersonal({ nombre, apellido, dni, tipo, email, telefono, especialidad, estado });
    if (error) return res.status(400).json({ message: error });

    try {
        const result = await db.query(
            `INSERT INTO personal (nombre, apellido, dni, tipo, email, especialidad, telefono, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [nombre, apellido, dni, tipo, email, especialidad || null, telefono, estado]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Modificación de legajo de personal docente / no docente (mismo ABM que alumnos).
exports.updatePersonal = async (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, dni, tipo, email } = req.body;
    const telefono = (req.body.telefono || '').trim();
    const especialidad = (req.body.especialidad || '').trim();
    const estado = (req.body.estado || 'Activo').trim();

    const error = validarPersonal({ nombre, apellido, dni, tipo, email, telefono, especialidad, estado });
    if (error) return res.status(400).json({ message: error });

    try {
        const result = await db.query(
            `UPDATE personal SET nombre = $1, apellido = $2, dni = $3, tipo = $4, email = $5,
                especialidad = $6, telefono = $7, estado = $8
             WHERE id = $9`,
            [nombre, apellido, dni, tipo, email, especialidad || null, telefono, estado, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: "Personal no encontrado" });
        res.json({ message: "Legajo de personal actualizado correctamente" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deletePersonal = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM personal WHERE id = $1', [id]);
        res.json({ message: "Personal eliminado" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- CUOTAS CONFIG ---
exports.getCuotasConfig = async (req, res) => {
    const query = `
        SELECT cc.*, n.nombre as nivel_nombre
        FROM cuotas_config cc
        JOIN niveles n ON cc.nivel_id = n.id
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createCuotaConfig = async (req, res) => {
    const { nivel_id, monto, mes, anio, vencimiento } = req.body;
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0) return res.status(400).json({ message: "El monto debe ser un decimal mayor a 0" });

    try {
        const result = await db.query(
            'INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [nivel_id, montoNum, mes, anio, vencimiento]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteCuotaConfig = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM cuotas_config WHERE id = $1', [id]);
        res.json({ message: "Configuración de cuota eliminada" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- PAGOS & DEUDA ---
// La lógica (validar, transacción pago + saldo, comprobante PDF) vive en PagosFacade
// (patrón Facade, ver src/patterns/pagosFacade.js). Acá solo se traduce a HTTP.
exports.registrarPago = async (req, res) => {
    const resultado = await PagosFacade.registrarPago(req.body);
    if (!resultado.ok) return res.status(resultado.status).json({ message: resultado.message });
    // Se devuelve el id del pago para poder descargar el comprobante PDF.
    res.status(201).json({ message: "Pago registrado y saldo actualizado", pago_id: resultado.pagoId });
};

// Genera y envía el comprobante de pago en PDF (detallado).
// Admin puede descargar cualquiera; un padre solo los de sus hijos vinculados.
exports.generarComprobante = async (req, res) => {
    const resultado = await PagosFacade.emitirComprobante({
        pagoId: req.params.pago_id,
        usuario: req.user,
        salida: res,
        onListo: (pago) => {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="comprobante_pago_${pago.id}.pdf"`);
        }
    });
    if (!resultado.ok) return res.status(resultado.status).json({ message: resultado.message });
};

exports.getSaldoAlumno = async (req, res) => {
    const { alumno_id } = req.params;
    try {
        const result = await db.query('SELECT * FROM saldos_alumnos WHERE alumno_id = $1', [alumno_id]);
        res.json(result.rows[0] || { saldo_pendiente: 0 });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Lista de pagos registrados. Admin ve todos; un padre solo los de sus hijos.
exports.getPagos = async (req, res) => {
    let query = `
        SELECT p.id, p.monto_pagado, p.fecha_pago, p.metodo_pago,
               a.nombre AS alumno_nombre, a.apellido AS alumno_apellido, a.dni AS alumno_dni
        FROM pagos p
        LEFT JOIN alumnos a ON p.alumno_id = a.id
    `;
    const params = [];
    if (req.user.rol === 'padre') {
        params.push(req.user.id);
        query += ` WHERE a.tutor_id = $${params.length}`;
    }
    query += ` ORDER BY p.fecha_pago DESC`;

    try {
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.getDeudores = async (req, res) => {
    const query = `
        SELECT a.id, a.nombre, a.apellido, a.dni,
               COALESCE(s.saldo_pendiente, 0) as saldo_pendiente
        FROM alumnos a
        LEFT JOIN saldos_alumnos s ON s.alumno_id = a.id
        WHERE COALESCE(s.saldo_pendiente, 0) > 0
        ORDER BY s.saldo_pendiente DESC
    `;
    try {
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
