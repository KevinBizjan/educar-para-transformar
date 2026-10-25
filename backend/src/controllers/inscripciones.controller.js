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
    MAX_DEPORTES_POR_ALUMNO, validarMesAnio, validarPeriodoInscripcion, rangoDelMes, ReglaError,
} = require('../utils/inscripciones');

const { validarHorarioGrupo, seSuperponen, describirHorario } = require('../utils/deportes');

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
                    s.dia_semana, s.hora_inicio, s.hora_fin,
                    a.nombre AS deporte, n.nombre AS nivel, (p.nombre || ' ' || p.apellido) AS docente,
                    COUNT(i.id)::int AS inscriptos
             FROM servicios s
             LEFT JOIN actividades_extra a ON a.id = s.actividad_id
             LEFT JOIN niveles n ON n.id = s.nivel_id
             LEFT JOIN personal p ON p.id = s.docente_id
             LEFT JOIN inscripciones_servicio i
                    ON i.servicio_id = s.id AND i.mes = $1 AND i.anio = $2 AND i.estado = 'Activa'
             WHERE s.activo = TRUE
             GROUP BY s.id, a.nombre, n.nombre, p.nombre, p.apellido
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

// --- Resumen de la familia (pantalla "Mis hijos" de la app, HU5) ---
// Devuelve en una sola respuesta los hijos del padre autenticado, con sus servicios del mes, el
// consumo real del comedor (la asistencia que ya registra la escuela) y el saldo pendiente.
// Son 3 consultas (2 de ellas en paralelo) sin importar cuántos hijos haya, para que la app cargue rápido.
exports.getResumenFamilia = async (req, res) => {
    const base = periodoActual();
    const mes = req.query.mes === undefined ? base.mes : parseInt(req.query.mes);
    const anio = req.query.anio === undefined ? base.anio : parseInt(req.query.anio);
    const error = validarMesAnio(mes, anio);
    if (error) return res.status(400).json({ message: error });
    const { desde, hasta } = rangoDelMes(mes, anio);

    try {
        const hijos = (await db.query(
            `SELECT a.id, a.nombre, a.apellido, c.division, n.nombre AS nivel,
                    COALESCE(s.saldo_pendiente, 0) AS saldo_pendiente
             FROM alumnos a
             LEFT JOIN cursos c ON c.id = a.curso_id
             LEFT JOIN niveles n ON n.id = c.nivel_id
             LEFT JOIN saldos_alumnos s ON s.alumno_id = a.id
             WHERE a.tutor_id = $1
             ORDER BY a.apellido, a.nombre`,
            [req.user.id]
        )).rows;
        const ids = hijos.map((h) => h.id);

        let servicios = [];
        let comedor = [];
        if (ids.length > 0) {
            // Las dos consultas no dependen entre sí: van en paralelo (una ida y vuelta menos a la base).
            const [respServicios, respComedor] = await Promise.all([
                db.query(
                    `SELECT i.id, i.alumno_id, i.servicio_id, s.tipo, s.nombre, s.precio_mensual,
                            s.dia_semana, s.hora_inicio, s.hora_fin
                     FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id
                     WHERE i.alumno_id = ANY($1) AND i.mes = $2 AND i.anio = $3 AND i.estado = 'Activa'
                     ORDER BY s.tipo, s.nombre`,
                    [ids, mes, anio]
                ),
                db.query(
                    `SELECT alumno_id,
                            COUNT(*) FILTER (WHERE consumio_menu)::int AS dias_consumidos,
                            COUNT(*)::int AS dias_registrados
                     FROM comedor_asistencias
                     WHERE alumno_id = ANY($1) AND fecha >= $2 AND fecha < $3
                     GROUP BY alumno_id`,
                    [ids, desde, hasta]
                ),
            ]);
            servicios = respServicios.rows;
            comedor = respComedor.rows;
        }

        const resultado = hijos.map((h) => {
            const susServicios = servicios.filter((s) => s.alumno_id === h.id)
                .map(({ alumno_id, ...resto }) => resto);
            const consumo = comedor.find((c) => c.alumno_id === h.id);
            return {
                id: h.id,
                nombre: h.nombre,
                apellido: h.apellido,
                nivel: h.nivel || null,
                division: h.division || null,
                saldo_pendiente: h.saldo_pendiente,
                estado_cuenta: h.saldo_pendiente > 0 ? 'Pendiente' : 'Al día',
                servicios: susServicios,
                total_servicios_mes: susServicios.reduce((suma, s) => suma + s.precio_mensual, 0),
                comedor: {
                    inscripto: susServicios.some((s) => s.tipo === 'Comedor'),
                    dias_consumidos: consumo ? consumo.dias_consumidos : 0,
                    dias_registrados: consumo ? consumo.dias_registrados : 0,
                },
            };
        });

        res.json({
            mes, anio,
            resumen: {
                cantidad_hijos: resultado.length,
                saldo_total: resultado.reduce((suma, h) => suma + h.saldo_pendiente, 0),
                total_servicios_mes: resultado.reduce((suma, h) => suma + h.total_servicios_mes, 0),
            },
            hijos: resultado,
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
            const deportes = (await consulta(
                `SELECT s.id, s.nombre, s.actividad_id, s.dia_semana, s.hora_inicio, s.hora_fin
                 FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id
                 WHERE i.alumno_id = $1 AND i.mes = $2 AND i.anio = $3 AND i.estado = 'Activa' AND s.tipo = 'Deporte'`,
                [alumnoId, mes, anio]
            )).rows;
            if (deportes.length >= MAX_DEPORTES_POR_ALUMNO) {
                throw new ReglaError(409, `Un alumno puede inscribirse como máximo en ${MAX_DEPORTES_POR_ALUMNO} deportes por mes`);
            }
            // Un grupo pertenece a un nivel: el alumno tiene que cursar en ese nivel (si tiene curso).
            if (servicio.nivel_id) {
                const nivelAlumno = (await consulta(
                    `SELECT c.nivel_id FROM alumnos a LEFT JOIN cursos c ON c.id = a.curso_id WHERE a.id = $1`, [alumnoId]
                )).rows[0].nivel_id;
                if (nivelAlumno && nivelAlumno !== servicio.nivel_id) {
                    const nivel = (await consulta('SELECT nombre FROM niveles WHERE id = $1', [servicio.nivel_id])).rows[0];
                    throw new ReglaError(409, `Este grupo es para el nivel ${nivel ? nivel.nombre : 'indicado'}`);
                }
            }
            // No dos grupos del mismo deporte, ni dos actividades que se pisen en el horario.
            if (servicio.actividad_id && deportes.some((d) => d.actividad_id === servicio.actividad_id)) {
                throw new ReglaError(409, 'El alumno ya está inscripto en este deporte (en otro grupo)');
            }
            const choque = deportes.find((d) => d.dia_semana && servicio.dia_semana && seSuperponen(d, servicio));
            if (choque) {
                throw new ReglaError(409, `El horario se superpone con "${choque.nombre}" (${describirHorario(choque)})`);
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

const entero = (v) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isInteger(n) ? n : null; };

// El profesor del grupo tiene que existir, ser docente activo y no tener otro grupo en ese horario.
const validarDocenteDeGrupo = async (docenteId, horario, excluirServicioId = 0) => {
    const docente = (await db.query('SELECT id, tipo, estado FROM personal WHERE id = $1', [docenteId])).rows[0];
    if (!docente || docente.tipo !== 'Docente') throw new ReglaError(400, 'El profesor indicado no existe o no es docente');
    if (docente.estado !== 'Activo') throw new ReglaError(400, 'El profesor indicado no está activo');
    const otros = (await db.query(
        `SELECT nombre, dia_semana, hora_inicio, hora_fin FROM servicios
         WHERE docente_id = $1 AND tipo = 'Deporte' AND activo = TRUE AND id <> $2 AND dia_semana IS NOT NULL`,
        [docenteId, excluirServicioId]
    )).rows;
    const choque = otros.find((o) => seSuperponen(o, horario));
    if (choque) {
        throw new ReglaError(409, `El profesor ya tiene el grupo "${choque.nombre}" en ese horario (${describirHorario(choque)})`);
    }
};

exports.crearServicio = async (req, res) => {
    const tipo = (req.body.tipo || '').trim();
    const nombre = (req.body.nombre || '').trim();
    const precio = numeroPositivo(req.body.precio_mensual);
    const cupo = enteroPositivoONulo(req.body.cupo_max);

    if (!TIPOS.includes(tipo)) return res.status(400).json({ message: 'El tipo debe ser Deporte, Transporte o Comedor' });
    if (!nombre || nombre.length > 80) return res.status(400).json({ message: 'El nombre es obligatorio (hasta 80 caracteres)' });
    if (precio === null) return res.status(400).json({ message: 'El precio mensual debe ser un número mayor a 0' });
    if (cupo === undefined) return res.status(400).json({ message: 'El cupo debe ser un entero mayor a 0 (o vacío si no tiene límite)' });

    const datos = { actividad_id: null, docente_id: null, nivel_id: null, dia_semana: null, hora_inicio: null, hora_fin: null, ruta_id: null };

    try {
        if (tipo === 'Deporte') {
            // Un grupo de deporte = el deporte + el nivel + el día y horario + el profesor a cargo.
            const actividadId = entero(req.body.actividad_id);
            const docenteId = entero(req.body.docente_id);
            const nivelId = entero(req.body.nivel_id);
            const dia = entero(req.body.dia_semana);
            const inicio = (req.body.hora_inicio || '').trim();
            const fin = (req.body.hora_fin || '').trim();
            if (!actividadId || !docenteId || !nivelId) {
                throw new ReglaError(400, 'Un grupo de deporte necesita el deporte, el profesor a cargo y el nivel');
            }
            const errorHorario = validarHorarioGrupo(dia, inicio, fin);
            if (errorHorario) throw new ReglaError(400, errorHorario);

            const actividad = (await db.query('SELECT tipo FROM actividades_extra WHERE id = $1', [actividadId])).rows[0];
            if (!actividad || actividad.tipo !== 'Deporte') throw new ReglaError(400, 'La actividad indicada no existe o no es un deporte');
            const nivel = (await db.query('SELECT id FROM niveles WHERE id = $1', [nivelId])).rows[0];
            if (!nivel) throw new ReglaError(400, 'El nivel indicado no existe');
            await validarDocenteDeGrupo(docenteId, { dia_semana: dia, hora_inicio: inicio, hora_fin: fin });

            Object.assign(datos, { actividad_id: actividadId, docente_id: docenteId, nivel_id: nivelId, dia_semana: dia, hora_inicio: inicio, hora_fin: fin });
        } else if (tipo === 'Transporte') {
            const rutaId = entero(req.body.ruta_id);
            if (!rutaId) throw new ReglaError(400, 'Un servicio de transporte necesita el recorrido');
            const ruta = (await db.query('SELECT id FROM transporte_rutas WHERE id = $1', [rutaId])).rows[0];
            if (!ruta) throw new ReglaError(400, 'El recorrido indicado no existe');
            datos.ruta_id = rutaId;
        }

        const r = await db.query(
            `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, actividad_id, ruta_id, docente_id, nivel_id, dia_semana, hora_inicio, hora_fin)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [tipo, nombre, precio, cupo, datos.actividad_id, datos.ruta_id, datos.docente_id, datos.nivel_id, datos.dia_semana, datos.hora_inicio, datos.hora_fin]
        );
        res.status(201).json({ id: r.rows[0].id });
    } catch (err) {
        if (err instanceof ReglaError) return res.status(err.estado).json({ message: err.message });
        if (err.code === '23505') return res.status(409).json({ message: 'Ya existe un servicio de ese tipo con ese nombre' });
        if (err.code === '23503') return res.status(400).json({ message: 'Alguno de los datos relacionados no existe' });
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.actualizarServicio = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Servicio inválido' });

    const cambios = [];
    const valores = [];
    const agregar = (columna, valor) => { valores.push(valor); cambios.push(`${columna} = $${valores.length}`); };

    try {
        if (req.body.precio_mensual !== undefined) {
            const precio = numeroPositivo(req.body.precio_mensual);
            if (precio === null) throw new ReglaError(400, 'El precio mensual debe ser un número mayor a 0');
            agregar('precio_mensual', precio);
        }
        if (req.body.cupo_max !== undefined) {
            const cupo = enteroPositivoONulo(req.body.cupo_max);
            if (cupo === undefined) throw new ReglaError(400, 'El cupo debe ser un entero mayor a 0 (o vacío si no tiene límite)');
            agregar('cupo_max', cupo);
        }
        if (req.body.activo !== undefined) {
            if (typeof req.body.activo !== 'boolean') throw new ReglaError(400, 'El campo activo debe ser verdadero o falso');
            agregar('activo', req.body.activo);
        }
        // Cambiar el profesor a cargo de un grupo (por ejemplo, un reemplazo).
        if (req.body.docente_id !== undefined) {
            const fila = (await db.query('SELECT tipo, dia_semana, hora_inicio, hora_fin FROM servicios WHERE id = $1', [id])).rows[0];
            if (!fila) throw new ReglaError(404, 'Servicio no encontrado');
            if (fila.tipo !== 'Deporte') throw new ReglaError(400, 'Solo los grupos de deporte tienen profesor a cargo');
            const docenteId = entero(req.body.docente_id);
            if (!docenteId) throw new ReglaError(400, 'El profesor es obligatorio');
            await validarDocenteDeGrupo(docenteId, fila, id);
            agregar('docente_id', docenteId);
        }
        if (cambios.length === 0) throw new ReglaError(400, 'No hay nada para actualizar');

        valores.push(id);
        const r = await db.query(`UPDATE servicios SET ${cambios.join(', ')} WHERE id = $${valores.length}`, valores);
        if (r.rowCount === 0) throw new ReglaError(404, 'Servicio no encontrado');
        res.json({ message: 'Servicio actualizado' });
    } catch (err) {
        responderError(res, err);
    }
};
