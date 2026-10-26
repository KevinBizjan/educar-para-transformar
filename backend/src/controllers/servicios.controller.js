const db = require('../config/database');
const { MAX_RECORRIDOS } = require('../utils/deportes');
const { MAX_PUNTO_ENCUENTRO, MAX_OBSERVACIONES, leerId, hayLugarEnRuta, leerConsumioMenu } = require('../utils/servicios');
const { leerPeriodo, ReglaError } = require('../utils/inscripciones');
const { legajoAlumnoSql } = require('../utils/reportes');
const { ocupantesDeRuta, rutasConOcupacion } = require('../services/transporte.service');

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- COMEDOR ---
// Un registro por alumno y por día: si la escuela vuelve a registrar al mismo alumno el mismo día, se corrige el
// registro del día en lugar de duplicarlo (así los "días con menú" de los reportes no se cuentan dos veces).
exports.registrarAsistenciaComedor = async (req, res) => {
    const alumnoId = leerId(req.body.alumno_id);
    if (!alumnoId) return res.status(400).json({ message: 'Debe indicar el alumno' });
    const consumio = leerConsumioMenu(req.body.consumio_menu);
    if (consumio === undefined) return res.status(400).json({ message: 'Indicá si consumió el menú (sí o no)' });
    const observaciones = String(req.body.observaciones || '').trim();
    if (observaciones.length > MAX_OBSERVACIONES) {
        return res.status(400).json({ message: `Las observaciones no pueden superar los ${MAX_OBSERVACIONES} caracteres` });
    }

    try {
        const alumno = await db.query('SELECT id FROM alumnos WHERE id = $1', [alumnoId]);
        if (!alumno.rows[0]) return res.status(404).json({ message: 'Alumno no encontrado' });

        const previo = (await db.query('SELECT id FROM comedor_asistencias WHERE alumno_id = $1 AND fecha = CURRENT_DATE', [alumnoId])).rows[0];
        if (previo) {
            await db.query('UPDATE comedor_asistencias SET consumio_menu = $1, observaciones = $2 WHERE id = $3', [consumio, observaciones || null, previo.id]);
            return res.json({ id: previo.id, actualizado: true });
        }
        const result = await db.query(
            'INSERT INTO comedor_asistencias (alumno_id, consumio_menu, observaciones) VALUES ($1, $2, $3) RETURNING id',
            [alumnoId, consumio, observaciones || null]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- TRANSPORTE ---
const responderError = (res, err) => {
    if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
    res.status(500).json({ message: err.message });
};

exports.getRutasTransporte = async (req, res) => {
    try {
        const { mes, anio } = leerPeriodo({});
        const rutas = await rutasConOcupacion((t, p) => db.query(t, p), mes, anio);
        res.json(rutas.map(r => ({
            id: r.id,
            nombre: r.nombre_ruta,
            chofer: r.chofer_nombre,
            capacidad: r.capacidad_max,
            ocupados: r.ocupados
        })));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.createRutaTransporte = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    const { chofer } = req.body;
    const capacidad = Number(req.body.capacidad);
    if (!nombre || !Number.isInteger(capacidad) || capacidad <= 0) {
        return res.status(400).json({ message: 'El nombre de la ruta y una capacidad entera mayor a 0 son obligatorios' });
    }

    try {
        // El servicio de transporte tiene cuatro recorridos.
        const { n } = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_rutas')).rows[0];
        if (n >= MAX_RECORRIDOS) {
            return res.status(409).json({ message: `El servicio de transporte tiene como máximo ${MAX_RECORRIDOS} recorridos` });
        }
        const repetida = await db.query('SELECT 1 FROM transporte_rutas WHERE LOWER(nombre_ruta) = LOWER($1)', [nombre]);
        if (repetida.rowCount > 0) return res.status(409).json({ message: 'Ya existe un recorrido con ese nombre' });

        const result = await db.query(
            'INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, $2, $3) RETURNING id',
            [nombre, chofer, capacidad]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'Ya existe un recorrido con ese nombre' });
        res.status(500).json({ message: err.message });
    }
};

// Asigna un alumno a un recorrido con su punto de encuentro. Reglas: el alumno existe y está activo, tiene una sola
// asignación (para cambiarla se quita y se vuelve a asignar) y el recorrido tiene lugar. La ocupación cuenta también
// a los inscriptos del mes en el servicio de ese recorrido. Todo dentro de una transacción con el recorrido bloqueado:
// dos asignaciones simultáneas no pueden superar la capacidad.
exports.asignarAlumnoTransporte = async (req, res) => {
    const alumnoId = leerId(req.body.alumno_id);
    const rutaId = leerId(req.body.ruta_id);
    if (!alumnoId || !rutaId) return res.status(400).json({ message: 'Debe indicar el alumno y la ruta' });
    const punto = String(req.body.punto_encuentro || '').trim();
    if (punto.length > MAX_PUNTO_ENCUENTRO) {
        return res.status(400).json({ message: `El punto de encuentro no puede superar los ${MAX_PUNTO_ENCUENTRO} caracteres` });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const consulta = (t, p) => client.query(t, p);

        // Bloqueo: alumno primero, recorrido después (siempre en el mismo orden).
        const alumno = (await consulta('SELECT id, estado FROM alumnos WHERE id = $1 FOR UPDATE', [alumnoId])).rows[0];
        if (!alumno) throw new ReglaError(404, 'Alumno no encontrado');
        if (alumno.estado !== 'Activo') throw new ReglaError(409, 'Solo se puede asignar transporte a un alumno activo');
        const ruta = (await consulta('SELECT id, nombre_ruta, capacidad_max FROM transporte_rutas WHERE id = $1 FOR UPDATE', [rutaId])).rows[0];
        if (!ruta) throw new ReglaError(404, 'La ruta no existe');

        const previa = (await consulta(
            'SELECT t.id, t.ruta_id, r.nombre_ruta FROM transporte_asignaciones t JOIN transporte_rutas r ON r.id = t.ruta_id WHERE t.alumno_id = $1', [alumnoId]
        )).rows[0];
        if (previa) {
            throw new ReglaError(409, previa.ruta_id === rutaId
                ? 'El alumno ya está asignado a esta ruta'
                : `El alumno ya tiene asignada la ruta "${previa.nombre_ruta}". Quitale esa asignación antes de asignarle otra.`);
        }

        const { mes, anio } = leerPeriodo({});
        const ocupantes = await ocupantesDeRuta(consulta, rutaId, mes, anio);
        if (!hayLugarEnRuta(ruta.capacidad_max, ocupantes.length, ocupantes.includes(alumnoId))) {
            throw new ReglaError(409, `La ruta "${ruta.nombre_ruta}" está completa (${ocupantes.length} de ${ruta.capacidad_max})`);
        }

        const result = await consulta(
            'INSERT INTO transporte_asignaciones (alumno_id, ruta_id, punto_encuentro) VALUES ($1, $2, $3) RETURNING id',
            [alumnoId, rutaId, punto || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ message: 'El alumno ya tiene una ruta asignada' });
        responderError(res, err);
    } finally {
        client.release();
    }
};

// Alumnos asignados por la administración, con su recorrido y punto de encuentro (opcionalmente de un solo recorrido).
exports.getAsignacionesTransporte = async (req, res) => {
    const filtro = req.query.ruta_id === undefined ? null : leerId(req.query.ruta_id);
    if (req.query.ruta_id !== undefined && !filtro) return res.status(400).json({ message: 'La ruta indicada no es válida' });
    try {
        const r = await db.query(
            `SELECT t.id, t.alumno_id, ${legajoAlumnoSql('a.id')} AS legajo, a.apellido, a.nombre,
                    t.ruta_id, r.nombre_ruta AS ruta, t.punto_encuentro
             FROM transporte_asignaciones t
             JOIN alumnos a ON a.id = t.alumno_id
             JOIN transporte_rutas r ON r.id = t.ruta_id
             WHERE ($1::int IS NULL OR t.ruta_id = $1)
             ORDER BY r.nombre_ruta, a.apellido, a.nombre`,
            [filtro]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.quitarAsignacionTransporte = async (req, res) => {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Asignación inválida' });
    try {
        const r = await db.query('DELETE FROM transporte_asignaciones WHERE id = $1', [id]);
        if (r.rowCount === 0) return res.status(404).json({ message: 'Asignación no encontrada' });
        res.json({ message: 'Asignación quitada' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// No se elimina un recorrido que todavía tiene alumnos asignados o un servicio de transporte en el catálogo:
// antes la base lo rechazaba con un error técnico.
exports.deleteRutaTransporte = async (req, res) => {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Ruta inválida' });
    try {
        const ruta = await db.query('SELECT id FROM transporte_rutas WHERE id = $1', [id]);
        if (!ruta.rows[0]) return res.status(404).json({ message: 'La ruta no existe' });

        const asignados = (await db.query('SELECT COUNT(*)::int AS n FROM transporte_asignaciones WHERE ruta_id = $1', [id])).rows[0].n;
        if (asignados > 0) {
            return res.status(409).json({ message: `La ruta tiene ${asignados} ${asignados === 1 ? 'alumno asignado' : 'alumnos asignados'}. Quitá las asignaciones antes de eliminarla.` });
        }
        const servicios = (await db.query('SELECT COUNT(*)::int AS n FROM servicios WHERE ruta_id = $1', [id])).rows[0].n;
        if (servicios > 0) {
            return res.status(409).json({ message: 'La ruta tiene un servicio de transporte en el catálogo con inscripciones: no se puede eliminar.' });
        }
        await db.query('DELETE FROM transporte_rutas WHERE id = $1', [id]);
        res.json({ message: 'Ruta eliminada' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- INSTALACIONES ---
exports.getInstalaciones = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM instalaciones');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.reservarInstalacion = async (req, res) => {
    const { instalacion_id, fecha, reservado_por, motivo } = req.body;
    const hora_inicio = (req.body.hora_inicio || '').trim();
    const hora_fin = (req.body.hora_fin || '').trim();

    if (!instalacion_id || !fecha || !hora_inicio || !hora_fin) {
        return res.status(400).json({ message: 'Instalación, fecha, hora de inicio y hora de fin son obligatorios' });
    }
    if (!HORA_REGEX.test(hora_inicio) || !HORA_REGEX.test(hora_fin)) {
        return res.status(400).json({ message: 'Las horas deben tener formato HH:MM (24h)' });
    }
    if (hora_inicio >= hora_fin) {
        return res.status(400).json({ message: 'La hora de inicio debe ser anterior a la hora de fin' });
    }

    try {
        // Validar disponibilidad
        const checkQuery = `
            SELECT COUNT(*) as count FROM instalaciones_reservas
            WHERE instalacion_id = $1 AND fecha = $2
            AND hora_inicio < $3 AND hora_fin > $4
        `;
        const checkResult = await db.query(checkQuery, [instalacion_id, fecha, hora_fin, hora_inicio]);
        if (checkResult.rows[0].count > 0) {
            return res.status(400).json({ message: 'La instalación ya está reservada en ese horario.' });
        }

        const result = await db.query(
            'INSERT INTO instalaciones_reservas (instalacion_id, fecha, hora_inicio, hora_fin, reservado_por, motivo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [instalacion_id, fecha, hora_inicio, hora_fin, reservado_por, motivo]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// --- ENFERMERÍA ---
exports.registrarIncidenciaEnfermeria = async (req, res) => {
    const { alumno_id, accion_tomada, notificado_padre } = req.body;
    const descripcion = (req.body.descripcion || '').trim();
    if (descripcion.length < 10) {
        return res.status(400).json({ message: 'La descripción debe tener al menos 10 caracteres.' });
    }

    try {
        const result = await db.query(
            'INSERT INTO enfermeria_incidencias (alumno_id, descripcion, accion_tomada, notificado_padre) VALUES ($1, $2, $3, $4) RETURNING id',
            [alumno_id, descripcion, accion_tomada, notificado_padre]
        );
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
