// Reportes de pagos de la Dirección (HU11 y HU12). Solo para el administrador. Usan el mismo formato, los mismos filtros y la
// misma descarga en CSV (?formato=csv) que los 9 listados (ver listados.controller.js).
//
// De dónde sale cada número (todo sale de las mismas tablas que usa la app, así que coincide con lo que las familias hacen):
//  - Lo adeudado: las cuotas del nivel de cada alumno activo (hasta el mes actual) y sus inscripciones activas a servicios.
//  - Lo pagado de una cuota: los pagos registrados (a mano o al aprobar una factura) o una factura pagada que la incluya.
//  - Lo pagado de un servicio: que esté en una factura dada por pagada. Una factura "En revisión" cuenta como pendiente.
const db = require('../config/database');
const { describirHorario } = require('../utils/deportes');
const { legajoAlumnoSql, seccion, reporte } = require('../utils/reportes');
const { pesos } = require('../services/facturasPdf');
const { hoyEnArgentina, aCentavos } = require('../utils/cuotas');
const { fechaLocalSql } = require('../utils/facturas');
const { MESES, CONCEPTOS, estadoPago, estadoCargo, estadoServicio, leerAnioMes, leerEstadoPago, sumar, describirPeriodo } = require('../utils/pagosReportes');
const { manejar, leerFiltros, leerPeriodo, Peticion } = require('./listados.controller').herramientas;

const LEGAJO_ALUMNO = legajoAlumnoSql('a.id');
const ALUMNO_NOMBRE = "a.apellido || ', ' || a.nombre";

const FACTURA_PAGADA = (item) => `EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id AND f.estado = 'Pagada' WHERE ${item})`;
const FACTURA_EN_REVISION = (item) => `EXISTS (SELECT 1 FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id AND f.estado = 'En revision' WHERE ${item})`;

const leerPeriodoDePago = (query) => {
    const p = leerAnioMes(query);
    if (p.error) throw new Peticion(400, p.error);
    return p;
};

// Un cargo por cada cuota emitida y cada servicio inscripto del período, con lo que se pagó de cada uno.
// Parámetros: año, mes (o nulo), año y mes de hoy (no se cobra lo que todavía no empezó), nivel, curso y alumno (o nulos).
const CARGOS = `
    WITH cargos AS (
        SELECT a.id AS alumno_id, 'Cuotas'::text AS concepto, cc.mes, cc.anio, cc.monto::numeric AS monto, cc.id AS cuota_id, NULL::int AS inscripcion_id, NULL::text AS detalle
        FROM alumnos a JOIN cursos c ON c.id = a.curso_id JOIN cuotas_config cc ON cc.nivel_id = c.nivel_id
        WHERE a.estado = 'Activo' AND cc.anio = $1 AND ($2::int IS NULL OR cc.mes = $2) AND (cc.anio < $3 OR (cc.anio = $3 AND cc.mes <= $4))
          AND ($5::int IS NULL OR c.nivel_id = $5) AND ($6::int IS NULL OR c.id = $6) AND ($7::int IS NULL OR a.id = $7)
        UNION ALL
        SELECT i.alumno_id, s.tipo, i.mes, i.anio, s.precio_mensual::numeric, NULL::int, i.id, s.nombre
        FROM inscripciones_servicio i JOIN servicios s ON s.id = i.servicio_id
        JOIN alumnos a ON a.id = i.alumno_id AND a.estado = 'Activo' LEFT JOIN cursos c ON c.id = a.curso_id
        WHERE i.estado = 'Activa' AND i.anio = $1 AND ($2::int IS NULL OR i.mes = $2) AND (i.anio < $3 OR (i.anio = $3 AND i.mes <= $4))
          AND ($5::int IS NULL OR c.nivel_id = $5) AND ($6::int IS NULL OR c.id = $6) AND ($7::int IS NULL OR a.id = $7)
    )
    SELECT cg.alumno_id, cg.concepto, cg.mes, cg.anio, cg.monto, cg.detalle,
           ${LEGAJO_ALUMNO} AS legajo, a.apellido, a.nombre, COALESCE(c.division, 'Sin curso') AS curso, COALESCE(n.nombre, 'Sin curso') AS nivel,
           CASE WHEN cg.cuota_id IS NOT NULL THEN
                    CASE WHEN ${FACTURA_PAGADA('fi.alumno_id = cg.alumno_id AND fi.cuota_id = cg.cuota_id')} THEN cg.monto
                         ELSE LEAST(cg.monto, COALESCE((SELECT SUM(p.monto_pagado) FROM pagos p WHERE p.alumno_id = cg.alumno_id AND p.cuota_id = cg.cuota_id), 0)) END
                WHEN ${FACTURA_PAGADA('fi.inscripcion_id = cg.inscripcion_id')} THEN cg.monto
                ELSE 0 END AS pagado,
           ${FACTURA_EN_REVISION('(cg.inscripcion_id IS NOT NULL AND fi.inscripcion_id = cg.inscripcion_id) OR (cg.cuota_id IS NOT NULL AND fi.alumno_id = cg.alumno_id AND fi.cuota_id = cg.cuota_id)')} AS en_revision
    FROM cargos cg JOIN alumnos a ON a.id = cg.alumno_id LEFT JOIN cursos c ON c.id = a.curso_id LEFT JOIN niveles n ON n.id = c.nivel_id
    ORDER BY a.apellido, a.nombre, cg.anio, cg.mes, cg.concepto`;

async function cargosDelPeriodo({ anio, mes }, { nivel_id = null, curso_id = null, alumno_id = null } = {}) {
    const hoy = hoyEnArgentina().split('-').map(Number);
    return (await db.query(CARGOS, [anio, mes, hoy[0], hoy[1], nivel_id, curso_id, alumno_id])).rows;
}

// Agrupa los cargos por alumno: lo adeudado, lo pagado, lo que falta y si el pago está completo
function porAlumno(cargos) {
    const mapa = new Map();
    for (const c of cargos) {
        const a = mapa.get(c.alumno_id) || { alumno_id: c.alumno_id, legajo: c.legajo, alumno: `${c.apellido}, ${c.nombre}`, nivel: c.nivel, curso: c.curso, cargos: [] };
        a.cargos.push(c);
        mapa.set(c.alumno_id, a);
    }
    return [...mapa.values()].map((a) => {
        const adeudado = sumar(a.cargos.map((c) => c.monto));
        const pagado = sumar(a.cargos.map((c) => c.pagado));
        return { ...a, adeudado, pagado, pendiente: sumar([adeudado, -pagado]), estado: estadoPago({ adeudado, pagado }) };
    });
}

const fila = (clave, valor) => ({ clave, valor });

// ---------------------------------------------------------------------------------------------
// HU11 · Ingresos por mes (lo cobrado, por fecha de pago) y lo que falta cobrar
// ---------------------------------------------------------------------------------------------
exports.ingresos = manejar('ingresos', async (req) => {
    const p = leerPeriodoDePago(req.query);
    const f = leerFiltros(req.query, ['nivel_id']);

    const cobrado = (await db.query(
        `WITH movimientos AS (
             SELECT ${fechaLocalSql('p.fecha_pago')} AS fecha, 'Cuotas'::text AS concepto, p.monto_pagado AS monto, a.curso_id
             FROM pagos p JOIN alumnos a ON a.id = p.alumno_id
             UNION ALL
             SELECT ${fechaLocalSql('f.pagada_en')}, s.tipo, fi.monto, a.curso_id
             FROM factura_items fi JOIN facturas f ON f.id = fi.factura_id AND f.estado = 'Pagada'
             JOIN inscripciones_servicio i ON i.id = fi.inscripcion_id JOIN servicios s ON s.id = i.servicio_id JOIN alumnos a ON a.id = fi.alumno_id
         )
         SELECT EXTRACT(MONTH FROM m.fecha)::int AS mes, m.concepto, SUM(m.monto) AS total, COUNT(*)::int AS cantidad
         FROM movimientos m LEFT JOIN cursos c ON c.id = m.curso_id
         WHERE EXTRACT(YEAR FROM m.fecha) = $1 AND ($2::int IS NULL OR EXTRACT(MONTH FROM m.fecha) = $2) AND ($3::int IS NULL OR c.nivel_id = $3)
         GROUP BY 1, 2`, [p.anio, p.mes, f.nivel_id]
    )).rows;

    const meses = p.mes ? [p.mes] : MESES.map((_, i) => i + 1);
    const montoDe = (mes, concepto) => sumar(cobrado.filter((c) => c.mes === mes && c.concepto === concepto).map((c) => c.total));
    const filas = meses.map((mes) => {
        const porConcepto = Object.fromEntries(CONCEPTOS.map((c) => [c, montoDe(mes, c)]));
        const pagos = cobrado.filter((c) => c.mes === mes).reduce((n, c) => n + c.cantidad, 0);
        return { mes: MESES[mes - 1], pagos, cuotas: pesos(porConcepto.Cuotas), deporte: pesos(porConcepto.Deporte), transporte: pesos(porConcepto.Transporte), comedor: pesos(porConcepto.Comedor), total: pesos(sumar(CONCEPTOS.map((c) => porConcepto[c]))) };
    });
    const totalCobrado = sumar(cobrado.map((c) => c.total));
    filas.push({
        mes: 'TOTAL', pagos: cobrado.reduce((n, c) => n + c.cantidad, 0),
        cuotas: pesos(sumar(cobrado.filter((c) => c.concepto === 'Cuotas').map((c) => c.total))),
        deporte: pesos(sumar(cobrado.filter((c) => c.concepto === 'Deporte').map((c) => c.total))),
        transporte: pesos(sumar(cobrado.filter((c) => c.concepto === 'Transporte').map((c) => c.total))),
        comedor: pesos(sumar(cobrado.filter((c) => c.concepto === 'Comedor').map((c) => c.total))),
        total: pesos(totalCobrado),
    });

    // Lo que falta cobrar del mismo período (por mes de la cuota o del servicio, no por fecha de pago)
    const alumnos = porAlumno(await cargosDelPeriodo(p, f));
    const adeudado = sumar(alumnos.map((a) => a.adeudado));
    const pagado = sumar(alumnos.map((a) => a.pagado));
    const resumen = [
        fila('Cobrado en el período (por fecha de pago)', pesos(totalCobrado)),
        fila('Adeudado por cuotas y servicios del período', pesos(adeudado)),
        fila('Pagado de lo adeudado', pesos(pagado)),
        fila('Pendiente de cobro', pesos(sumar([adeudado, -pagado]))),
        fila('Alumnos con pago completo', String(alumnos.filter((a) => a.estado === 'Completo').length)),
        fila('Alumnos con pago incompleto', String(alumnos.filter((a) => a.estado === 'Incompleto').length)),
    ];
    return reporte(`Ingresos (${describirPeriodo(p)})`, [
        seccion('Ingresos por mes', [['mes', 'Mes'], ['pagos', 'Pagos'], ['cuotas', 'Cuotas'], ['deporte', 'Deportes'], ['transporte', 'Transporte'], ['comedor', 'Comedor'], ['total', 'Total']], filas),
        seccion('Resumen del período', [['clave', 'Concepto'], ['valor', 'Valor']], resumen),
    ], { ...f, ...p });
});

// ---------------------------------------------------------------------------------------------
// HU11 · Pagos por alumno: completos o incompletos, por período y año escolar
// ---------------------------------------------------------------------------------------------
exports.pagosPorAlumno = manejar('pagos-por-alumno', async (req) => {
    const p = leerPeriodoDePago(req.query);
    const f = leerFiltros(req.query, ['nivel_id', 'curso_id', 'alumno_id']);
    const e = leerEstadoPago(req.query.estado_pago);
    if (e.error) throw new Peticion(400, e.error);

    const todos = porAlumno(await cargosDelPeriodo(p, f));
    const alumnos = e.estado ? todos.filter((a) => a.estado === e.estado) : todos;
    const filas = alumnos.map((a) => ({ legajo: a.legajo, alumno: a.alumno, nivel: a.nivel, curso: a.curso, adeudado: pesos(a.adeudado), pagado: pesos(a.pagado), pendiente: pesos(a.pendiente), estado: a.estado }));
    filas.push({
        legajo: '', alumno: `TOTAL (${alumnos.length} alumnos)`, nivel: '', curso: '', adeudado: pesos(sumar(alumnos.map((a) => a.adeudado))),
        pagado: pesos(sumar(alumnos.map((a) => a.pagado))), pendiente: pesos(sumar(alumnos.map((a) => a.pendiente))), estado: '',
    });
    const secciones = [seccion('Pagos por alumno', [['legajo', 'Legajo'], ['alumno', 'Alumno'], ['nivel', 'Nivel'], ['curso', 'Curso'], ['adeudado', 'Adeudado'], ['pagado', 'Pagado'], ['pendiente', 'Pendiente'], ['estado', 'Estado']], filas)];

    // Con un alumno elegido, el detalle de cada cuota y servicio
    if (f.alumno_id) {
        const detalle = todos.flatMap((a) => a.cargos).map((c) => ({
            concepto: c.concepto === 'Cuotas' ? 'Cuota' : `${c.concepto}: ${c.detalle}`, periodo: `${MESES[c.mes - 1]} ${c.anio}`,
            monto: pesos(c.monto), pagado: pesos(c.pagado), estado: estadoCargo({ monto: c.monto, pagado: c.pagado, enRevision: c.en_revision }),
        }));
        secciones.push(seccion('Detalle de cuotas y servicios', [['concepto', 'Concepto'], ['periodo', 'Período'], ['monto', 'Monto'], ['pagado', 'Pagado'], ['estado', 'Estado']], detalle));
    }
    return reporte(`Pagos por alumno (${describirPeriodo(p)})`, secciones, { ...f, ...p, ...(e.estado ? { estado_pago: e.estado } : {}) });
});

// ---------------------------------------------------------------------------------------------
// HU12 · Pagos por deporte: por profesor, horario y nivel
// ---------------------------------------------------------------------------------------------
exports.pagosPorDeporte = manejar('pagos-por-deporte', async (req) => {
    const f = leerFiltros(req.query, ['actividad_id', 'nivel_id']);
    const p = leerPeriodo(req.query);
    const grupos = (await db.query(
        `SELECT s.id AS servicio_id, COALESCE(d.nombre, s.nombre) AS deporte, COALESCE(ng.nombre, 'Sin nivel') AS nivel, s.dia_semana, s.hora_inicio, s.hora_fin,
                COALESCE(pr.apellido || ', ' || pr.nombre, 'Sin profesor') AS profesor, s.precio_mensual AS precio,
                COUNT(i.id)::int AS inscriptos,
                COUNT(i.id) FILTER (WHERE ${FACTURA_PAGADA('fi.inscripcion_id = i.id')})::int AS pagados
         FROM servicios s
         LEFT JOIN inscripciones_servicio i ON i.servicio_id = s.id AND i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
              AND EXISTS (SELECT 1 FROM alumnos a WHERE a.id = i.alumno_id AND a.estado = 'Activo')
         LEFT JOIN actividades_extra d ON d.id = s.actividad_id
         LEFT JOIN niveles ng ON ng.id = s.nivel_id
         LEFT JOIN personal pr ON pr.id = s.docente_id
         WHERE s.tipo = 'Deporte' AND s.activo AND ($3::int IS NULL OR s.actividad_id = $3) AND ($4::int IS NULL OR s.nivel_id = $4)
         GROUP BY s.id, d.nombre, ng.nombre, pr.apellido, pr.nombre
         ORDER BY profesor, s.dia_semana, s.hora_inicio, nivel, deporte`, [p.mes, p.anio, f.actividad_id, f.nivel_id]
    )).rows;

    const calcular = (g) => {
        const facturado = sumar(Array(g.inscriptos).fill(g.precio));
        const pagado = sumar(Array(g.pagados).fill(g.precio));
        return { facturado, pagado, pendiente: sumar([facturado, -pagado]) };
    };
    const conMontos = grupos.map((g) => ({ ...g, ...calcular(g) }));
    const filas = conMontos.map((g) => ({
        profesor: g.profesor, horario: g.dia_semana ? describirHorario(g) : 'Sin horario', nivel: g.nivel, deporte: g.deporte, inscriptos: g.inscriptos,
        facturado: pesos(g.facturado), pagado: pesos(g.pagado), pendiente: pesos(g.pendiente),
    }));
    const total = (lista) => ({ inscriptos: lista.reduce((n, g) => n + g.inscriptos, 0), facturado: pesos(sumar(lista.map((g) => g.facturado))), pagado: pesos(sumar(lista.map((g) => g.pagado))), pendiente: pesos(sumar(lista.map((g) => g.pendiente))) });
    filas.push({ profesor: 'TOTAL', horario: '', nivel: '', deporte: '', ...total(conMontos) });

    const profesores = [...new Set(conMontos.map((g) => g.profesor))].map((nombre) => {
        const suyos = conMontos.filter((g) => g.profesor === nombre);
        return { profesor: nombre, grupos: suyos.length, ...total(suyos) };
    });
    return reporte(`Pagos por deporte, profesor, horario y nivel (${p.mes}/${p.anio})`, [
        seccion('Pagos por grupo', [['profesor', 'Profesor a cargo'], ['horario', 'Horario'], ['nivel', 'Nivel'], ['deporte', 'Deporte'], ['inscriptos', 'Inscriptos'], ['facturado', 'Facturado'], ['pagado', 'Pagado'], ['pendiente', 'Pendiente']], filas),
        seccion('Total por profesor', [['profesor', 'Profesor a cargo'], ['grupos', 'Grupos'], ['inscriptos', 'Inscriptos'], ['facturado', 'Facturado'], ['pagado', 'Pagado'], ['pendiente', 'Pendiente']], profesores),
    ], { ...f, ...p });
});

// ---------------------------------------------------------------------------------------------
// HU12 · Pagos por recorrido de transporte (las inscripciones del mes que hicieron las familias desde la app)
// ---------------------------------------------------------------------------------------------
exports.pagosPorRecorrido = manejar('pagos-por-recorrido', async (req) => {
    const f = leerFiltros(req.query, ['ruta_id']);
    const p = leerPeriodo(req.query);
    const r = (await db.query(
        `SELECT r.id AS ruta_id, r.nombre_ruta AS recorrido, COALESCE(r.chofer_nombre, '-') AS chofer, r.capacidad_max AS capacidad, s.precio_mensual AS precio,
                a.id AS alumno_id, ${ALUMNO_NOMBRE} AS alumno, COALESCE(n.nombre, 'Sin curso') AS nivel, COALESCE(c.division, 'Sin curso') AS curso,
                ${FACTURA_PAGADA('fi.inscripcion_id = i.id')} AS pagado, ${FACTURA_EN_REVISION('fi.inscripcion_id = i.id')} AS en_revision
         FROM servicios s
         JOIN transporte_rutas r ON r.id = s.ruta_id
         LEFT JOIN inscripciones_servicio i ON i.servicio_id = s.id AND i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
         LEFT JOIN alumnos a ON a.id = i.alumno_id AND a.estado = 'Activo'
         LEFT JOIN cursos c ON c.id = a.curso_id LEFT JOIN niveles n ON n.id = c.nivel_id
         WHERE s.tipo = 'Transporte' AND s.activo AND ($3::int IS NULL OR r.id = $3)
         ORDER BY r.nombre_ruta, a.apellido, a.nombre`, [p.mes, p.anio, f.ruta_id]
    )).rows;

    const inscriptos = r.filter((x) => x.alumno_id);
    const detalle = inscriptos.map((x) => ({
        recorrido: x.recorrido, alumno: x.alumno, nivel: x.nivel, curso: x.curso, monto: pesos(x.precio), estado: estadoServicio({ pagado: x.pagado, enRevision: x.en_revision }),
    }));
    const rutas = [...new Map(r.map((x) => [x.ruta_id, x])).values()].map((x) => {
        const suyos = inscriptos.filter((i) => i.ruta_id === x.ruta_id);
        const pagados = suyos.filter((i) => i.pagado).length;
        const facturado = sumar(suyos.map((i) => i.precio));
        const pagado = sumar(suyos.filter((i) => i.pagado).map((i) => i.precio));
        return { recorrido: x.recorrido, chofer: x.chofer, inscriptos: suyos.length, capacidad: x.capacidad, pagados, facturado: pesos(facturado), pagado: pesos(pagado), pendiente: pesos(sumar([facturado, -pagado])) };
    });
    const facturadoTotal = sumar(inscriptos.map((i) => i.precio));
    const pagadoTotal = sumar(inscriptos.filter((i) => i.pagado).map((i) => i.precio));
    rutas.push({ recorrido: 'TOTAL', chofer: '', inscriptos: inscriptos.length, capacidad: '', pagados: inscriptos.filter((i) => i.pagado).length, facturado: pesos(facturadoTotal), pagado: pesos(pagadoTotal), pendiente: pesos(sumar([facturadoTotal, -pagadoTotal])) });
    return reporte(`Pagos por recorrido de transporte (${p.mes}/${p.anio})`, [
        seccion('Pagos por recorrido', [['recorrido', 'Recorrido'], ['chofer', 'Chofer'], ['inscriptos', 'Inscriptos'], ['capacidad', 'Capacidad'], ['pagados', 'Pagados'], ['facturado', 'Facturado'], ['pagado', 'Pagado'], ['pendiente', 'Pendiente']], rutas),
        seccion('Detalle por alumno', [['recorrido', 'Recorrido'], ['alumno', 'Alumno'], ['nivel', 'Nivel'], ['curso', 'Curso'], ['monto', 'Monto'], ['estado', 'Estado']], detalle),
    ], { ...f, ...p });
});

exports.aCentavos = aCentavos;
