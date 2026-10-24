// Inscripciones de los alumnos a servicios (deportes, transporte y comedor) - HU4.
//
// Reglas:
//  - Máximo 2 deportes por alumno y por mes.
//  - Un solo recorrido de transporte por alumno y por mes (puede cambiar de un mes a otro).
//  - Cada servicio puede tener un cupo mensual: no se inscribe si ya está completo.
//  - Un padre/tutor solo inscribe a sus propios hijos; el administrador, a cualquiera.
//
// Los límites se controlan dentro de una transacción con bloqueo de filas (primero el alumno,
// después el servicio, siempre en ese orden) para que dos pedidos simultáneos no puedan
// superar un cupo ni el máximo de deportes.
const db = require('../config/database');
const {
    MAX_DEPORTES_POR_ALUMNO, validarMesAnio, validarPeriodoInscripcion, ReglaError,
} = require('../utils/inscripciones');

const TIPOS = ['Deporte', 'Transporte', 'Comedor'];

const hoy = () => new Date();
const periodoActual = () => ({ mes: hoy().getMonth() + 1, anio: hoy().getFullYear() });

// Responde el error de una regla de negocio o un 500 genérico.
const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    return res.status(500).json({ message: 'Error en el servidor' });
};

// Un padre solo accede a sus hijos; el administrador, a cualquier alumno.
const alumnoAccesible = async (consulta, alumnoId, usuario) => {
    const r = await consulta('SELECT id, tutor_id FROM alumnos WHERE id = $1', [alumnoId]);
    const alumno = r.rows[0];
    if (!alumno) throw new ReglaError(404, 'Alumno no encontrado');
    if (usuario.rol === 'padre' && alumno.tutor_id !== usuario.id) {
        throw new ReglaError(403, 'Solo podés gestionar a tus propios hijos');
    }
    return alumno;
};

// --- Catálogo con cupos del mes ---
exports.getCatalogo = async (req, res) => {
    const base = periodoActual();
    const mes = req.query.mes === undefined ? base.mes : parseInt(req.query.mes);
    const anio = req.query.anio === undefined ? base.anio : parseInt(req.query.anio);
    const error = validarMesAnio(mes, anio);
    if (error) return res.status(400).json({ message: error });

    try {
        const r = await db.query(
            `SELECT s.id, s.tipo, s.nombre, s.precio_mensual, s.cupo_max,
                    COUNT(i.id)::int AS inscriptos
             FROM servicios s
             LEFT JOIN inscripciones_servicio i
                    ON i.servicio_id = s.id AND i.mes = $1 AND i.anio = $2 AND i.estado = 'Activa'
             WHERE s.activo = TRUE
             GROUP BY s.id
             ORDER BY s.tipo, s.nombre`,
            [mes, anio]
        );
        res.json({
            mes, anio,
            servicios: r.rows.map((s) => ({
                ...s,
                cupo_disponible: s.cupo_max === null ? null : Math.max(s.cupo_max - s.inscriptos, 0),
            })),
        });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// --- Inscripciones activas de un hijo ---
exports.getInscripcionesAlumno = async (req, res) => {
    const alumnoId = parseInt(req.params.alumno_id);
    if (!alumnoId) return res.status(400).json({ message: 'Alumno inválido' });

    const params = [alumnoId];
    let filtro = '';
    if (req.query.mes !== undefined || req.query.anio !== undefined) {
        const mes = parseInt(req.query.mes);
        const anio = parseInt(req.query.anio);
        const error = validarMesAnio(mes, anio);
        if (error) return res.status(400).json({ message: error });
        params.push(mes, anio);
        filtro = 'AND i.mes = $2 AND i.anio = $3';
    }

    try {
        await alumnoAccesible((t, p) => db.query(t, p), alumnoId, req.user);
        const r = await db.query(
            `SELECT i.id, i.servicio_id, s.tipo, s.nombre, s.precio_mensual, i.mes, i.anio, i.estado
             FROM inscripciones_servicio i
             JOIN servicios s ON s.id = i.servicio_id
             WHERE i.alumno_id = $1 AND i.estado = 'Activa' ${filtro}
             ORDER BY i.anio, i.mes, s.tipo, s.nombre`,
            params
        );
        res.json(r.rows);
    } catch (err) {
        responderError(res, err);
    }
};

// --- Inscribir ---
exports.inscribir = async (req, res) => {
    const alumnoId = parseInt(req.body.alumno_id);
    const servicioId = parseInt(req.body.servicio_id);
    const mes = parseInt(req.body.mes);
    const anio = parseInt(req.body.anio);

    if (!alumnoId || !servicioId) {
        return res.status(400).json({ message: 'El alumno y el servicio son obligatorios' });
    }
    const errorPeriodo = validarPeriodoInscripcion(mes, anio);
    if (errorPeriodo) return res.status(400).json({ message: errorPeriodo });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const consulta = (t, p) => client.query(t, p);

        await alumnoAccesible(consulta, alumnoId, req.user);
        // Bloqueo: alumno primero, servicio después (mismo orden siempre, sin interbloqueos).
        await consulta('SELECT id FROM alumnos WHERE id = $1 FOR UPDATE', [alumnoId]);
        const servicio = (await consulta('SELECT * FROM servicios WHERE id = $1 FOR UPDATE', [servicioId])).rows[0];
        if (!servicio || !servicio.activo) {
            throw new ReglaError(404, 'El servicio no existe o no está disponible');
        }

        const previa = (await consulta(
            'SELECT id, estado FROM inscripciones_servicio WHERE alumno_id = $1 AND servicio_id = $2 AND mes = $3 AND anio = $4',
            [alumnoId, servicioId, mes, anio]
        )).rows[0];
        if (previa && previa.estado === 'Activa') {
            throw new ReglaError(409, 'El alumno ya está inscripto en este servicio ese mes');
        }

        // Límites por alumno y por mes
        if (servicio.tipo === 'Deporte') {
            const n = (await consulta(
                `SELECT COUNT(*)::int AS n FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id
                 WHERE i.alumno_id = $1 AND i.mes = $2 AND i.anio = $3 AND i.estado = 'Activa' AND s.tipo = 'Deporte'`,
                [alumnoId, mes, anio]
            )).rows[0].n;
            if (n >= MAX_DEPORTES_POR_ALUMNO) {
                throw new ReglaError(409, `Un alumno puede inscribirse como máximo en ${MAX_DEPORTES_POR_ALUMNO} deportes por mes`);
            }
        }
        if (servicio.tipo === 'Transporte') {
            const n = (await consulta(
                `SELECT COUNT(*)::int AS n FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id
                 WHERE i.alumno_id = $1 AND i.mes = $2 AND i.anio = $3 AND i.estado = 'Activa' AND s.tipo = 'Transporte'`,
                [alumnoId, mes, anio]
            )).rows[0].n;
            if (n >= 1) {
                throw new ReglaError(409, 'El alumno ya tiene un recorrido de transporte ese mes. Dalo de baja para elegir otro.');
            }
        }

        // Cupo del servicio en ese mes
        if (servicio.cupo_max !== null) {
            const ocupados = (await consulta(
                `SELECT COUNT(*)::int AS n FROM inscripciones_servicio
                 WHERE servicio_id = $1 AND mes = $2 AND anio = $3 AND estado = 'Activa'`,
                [servicioId, mes, anio]
            )).rows[0].n;
            if (ocupados >= servicio.cupo_max) {
                throw new ReglaError(409, 'No hay cupo disponible en este servicio para ese mes');
            }
        }

        let id;
        if (previa) { // estaba dada de baja: se reactiva
            await consulta("UPDATE inscripciones_servicio SET estado = 'Activa' WHERE id = $1", [previa.id]);
            id = previa.id;
        } else {
            id = (await consulta(
                'INSERT INTO inscripciones_servicio (alumno_id, servicio_id, mes, anio) VALUES ($1, $2, $3, $4) RETURNING id',
                [alumnoId, servicioId, mes, anio]
            )).rows[0].id;
        }
        await client.query('COMMIT');
        res.status(201).json({
            id, alumno_id: alumnoId, servicio_id: servicioId, mes, anio,
            tipo: servicio.tipo, nombre: servicio.nombre, precio_mensual: servicio.precio_mensual,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        responderError(res, err);
    } finally {
        client.release();
    }
};

// --- Dar de baja ---
exports.darDeBaja = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Inscripción inválida' });

    try {
        const insc = (await db.query('SELECT id, alumno_id, estado FROM inscripciones_servicio WHERE id = $1', [id])).rows[0];
        if (!insc) return res.status(404).json({ message: 'Inscripción no encontrada' });
        await alumnoAccesible((t, p) => db.query(t, p), insc.alumno_id, req.user);

        if (insc.estado === 'Baja') return res.json({ message: 'La inscripción ya estaba dada de baja' });

        const facturada = await db.query(
            `SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id
             WHERE fi.inscripcion_id = $1 AND f.estado <> 'Rechazada' LIMIT 1`,
            [id]
        );
        if (facturada.rowCount > 0) {
            return res.status(409).json({ message: 'La inscripción ya fue facturada: no se puede dar de baja' });
        }
        await db.query("UPDATE inscripciones_servicio SET estado = 'Baja' WHERE id = $1", [id]);
        res.json({ message: 'Inscripción dada de baja' });
    } catch (err) {
        responderError(res, err);
    }
};

// --- Administración del catálogo (solo admin) ---
const numeroPositivo = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const enteroPositivoONulo = (v) => (v === null || v === undefined || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined));

exports.crearServicio = async (req, res) => {
    const tipo = (req.body.tipo || '').trim();
    const nombre = (req.body.nombre || '').trim();
    const precio = numeroPositivo(req.body.precio_mensual);
    const cupo = enteroPositivoONulo(req.body.cupo_max);

    if (!TIPOS.includes(tipo)) return res.status(400).json({ message: 'El tipo debe ser Deporte, Transporte o Comedor' });
    if (!nombre || nombre.length > 80) return res.status(400).json({ message: 'El nombre es obligatorio (hasta 80 caracteres)' });
    if (precio === null) return res.status(400).json({ message: 'El precio mensual debe ser un número mayor a 0' });
    if (cupo === undefined) return res.status(400).json({ message: 'El cupo debe ser un entero mayor a 0 (o vacío si no tiene límite)' });

    try {
        const r = await db.query(
            `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, actividad_id, ruta_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [tipo, nombre, precio, cupo,
                tipo === 'Deporte' ? (parseInt(req.body.actividad_id) || null) : null,
                tipo === 'Transporte' ? (parseInt(req.body.ruta_id) || null) : null]
        );
        res.status(201).json({ id: r.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'Ya existe un servicio de ese tipo con ese nombre' });
        if (err.code === '23503') return res.status(400).json({ message: 'La actividad o el recorrido indicado no existe' });
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.actualizarServicio = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Servicio inválido' });

    const cambios = [];
    const valores = [];
    const agregar = (columna, valor) => { valores.push(valor); cambios.push(`${columna} = $${valores.length}`); };

    if (req.body.precio_mensual !== undefined) {
        const precio = numeroPositivo(req.body.precio_mensual);
        if (precio === null) return res.status(400).json({ message: 'El precio mensual debe ser un número mayor a 0' });
        agregar('precio_mensual', precio);
    }
    if (req.body.cupo_max !== undefined) {
        const cupo = enteroPositivoONulo(req.body.cupo_max);
        if (cupo === undefined) return res.status(400).json({ message: 'El cupo debe ser un entero mayor a 0 (o vacío si no tiene límite)' });
        agregar('cupo_max', cupo);
    }
    if (req.body.activo !== undefined) {
        if (typeof req.body.activo !== 'boolean') return res.status(400).json({ message: 'El campo activo debe ser verdadero o falso' });
        agregar('activo', req.body.activo);
    }
    if (cambios.length === 0) return res.status(400).json({ message: 'No hay nada para actualizar' });

    try {
        valores.push(id);
        const r = await db.query(`UPDATE servicios SET ${cambios.join(', ')} WHERE id = $${valores.length}`, valores);
        if (r.rowCount === 0) return res.status(404).json({ message: 'Servicio no encontrado' });
        res.json({ message: 'Servicio actualizado' });
    } catch (err) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
};
