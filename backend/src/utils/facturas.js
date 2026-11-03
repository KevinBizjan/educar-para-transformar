// Reglas puras de la factura consolidada que arma el padre/tutor (HU7): validar lo que elige, calcular el total
// exacto, nombrar cada ítem y generar la referencia de pago. Sin base de datos, para poder probarlas con Node.
const { aCentavos } = require('./cuotas');

const MAX_ITEMS = 50;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ESTADOS_ABIERTOS = ['Pendiente', 'En revision']; // una factura así todavía puede pagarse: sus ítems no se vuelven a facturar

const mayuscula = (texto) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
const periodo = (mes, anio) => `${mayuscula(MESES[mes - 1] || '')} ${anio}`;

// Clave que identifica un ítem seleccionable, para detectar repetidos y cruzar lo pedido con lo disponible.
const claveItem = (item) => (item.tipo === 'cuota' ? `cuota:${item.alumno_id}:${item.cuota_id}` : `servicio:${item.inscripcion_id}`);

const esId = (valor) => Number.isInteger(valor) && valor > 0;

// Valida la forma de lo que manda la app. Devuelve { items } normalizados o { error }.
const validarSeleccion = (items) => {
    if (!Array.isArray(items) || items.length === 0) return { error: 'Elegí al menos una cuota o un servicio para pagar' };
    if (items.length > MAX_ITEMS) return { error: `Se pueden pagar hasta ${MAX_ITEMS} ítems por factura` };
    const vistos = new Set();
    const normalizados = [];
    for (const item of items) {
        let normal;
        if (item && item.tipo === 'cuota' && esId(item.alumno_id) && esId(item.cuota_id)) normal = { tipo: 'cuota', alumno_id: item.alumno_id, cuota_id: item.cuota_id };
        else if (item && item.tipo === 'servicio' && esId(item.inscripcion_id)) normal = { tipo: 'servicio', inscripcion_id: item.inscripcion_id };
        else return { error: 'Hay un ítem inválido en la selección' };
        const clave = claveItem(normal);
        if (vistos.has(clave)) return { error: 'Hay un ítem repetido en la selección' };
        vistos.add(clave);
        normalizados.push(normal);
    }
    return { items: normalizados };
};

// Total exacto en pesos, sumando en centavos enteros.
const totalFactura = (items) => items.reduce((suma, i) => suma + aCentavos(i.monto), 0) / 100;

const descripcionCuota = (cuota) => `Cuota de ${periodo(cuota.mes, cuota.anio)} - ${cuota.alumno}`;
const descripcionServicio = (servicio) => {
    const nombre = servicio.nombre.toLowerCase().startsWith(servicio.tipo.toLowerCase()) ? servicio.nombre : `${servicio.tipo}: ${servicio.nombre}`;
    return `${nombre} (${periodo(servicio.mes, servicio.anio)}) - ${servicio.alumno}`;
};

// Referencia que el padre escribe en la transferencia: EPT-AAAAMMDD-XXXXXX. Sin letras ni números que se confundan (0/O, 1/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const azarReferencia = (azar = Math.random) => Array.from({ length: 6 }, () => ALFABETO[Math.floor(azar() * ALFABETO.length)]).join('');
const referenciaFactura = (hoy, sufijo = azarReferencia()) => `EPT-${hoy.replace(/-/g, '')}-${sufijo}`;

// Datos para hacer la transferencia, tomados de la configuración del servidor (nunca del código). Sin ninguno, null.
const datosBancarios = (env = process.env) => {
    const datos = { titular: env.PAGO_TITULAR, banco: env.PAGO_BANCO, cbu: env.PAGO_CBU, alias: env.PAGO_ALIAS };
    return Object.values(datos).some(Boolean) ? datos : null;
};

const NOTA_PAGO = 'El pago se realiza solo por transferencia bancaria. No se aceptan pagos en efectivo.';

// --- Revisión de la Dirección (HU9) ---
const ESTADOS = ['Pendiente', 'En revision', 'Pagada', 'Rechazada'];
// De qué estado a cuál puede pasar una factura. Pagada y Rechazada son finales; una factura sin comprobantes
// (Pendiente) no se puede dar por pagada, solo anular.
const TRANSICIONES = { 'En revision': ['Pagada', 'Rechazada'], Pendiente: ['Rechazada'] };
const MAX_MOTIVO = 300;

// Valida el pedido de la Dirección { estado, motivo } contra el estado actual. Devuelve { estado, motivo } o { error, codigo }.
const validarRevision = (pedido, actual) => {
    const hacia = pedido && pedido.estado;
    if (hacia !== 'Pagada' && hacia !== 'Rechazada') return { codigo: 400, error: 'El nuevo estado tiene que ser Pagada o Rechazada' };
    if (!(TRANSICIONES[actual] || []).includes(hacia)) {
        return { codigo: 409, error: `Una factura ${actual === 'Pagada' || actual === 'Rechazada' ? actual.toLowerCase() : 'en estado ' + actual} no puede pasar a ${hacia}` };
    }
    if (hacia === 'Pagada') return { estado: hacia, motivo: null };
    const motivo = typeof pedido.motivo === 'string' ? pedido.motivo.trim() : '';
    if (!motivo) return { codigo: 400, error: 'Indicá el motivo del rechazo para que la familia sepa qué corregir' };
    if (motivo.length > MAX_MOTIVO) return { codigo: 400, error: `El motivo no puede superar los ${MAX_MOTIVO} caracteres` };
    return { estado: hacia, motivo };
};

// Fecha AAAA-MM-DD que exista de verdad (no el 31 de febrero)
const esFecha = (texto) => {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const d = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
};

// Rango de fechas de un historial: ambos extremos son opcionales, pero si vienen tienen que ser fechas y estar en orden.
const validarRango = ({ desde, hasta } = {}) => {
    for (const [nombre, valor] of [['desde', desde], ['hasta', hasta]]) {
        if (valor !== undefined && valor !== '' && !esFecha(valor)) return { error: `La fecha "${nombre}" no es válida (usá AAAA-MM-DD)` };
    }
    const d = desde || null;
    const h = hasta || null;
    if (d && h && d > h) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };
    return { desde: d, hasta: h };
};

// Totales de un conjunto de facturas, en centavos exactos: lo pagado, lo que sigue pendiente (incluye lo que está en
// revisión), lo rechazado y el total de todas.
const resumenFacturas = (facturas) => {
    const suma = (estados) => facturas.filter((f) => estados.includes(f.estado)).reduce((total, f) => total + aCentavos(f.total), 0) / 100;
    return {
        cantidad: facturas.length,
        total_facturado: suma(ESTADOS),
        total_pagado: suma(['Pagada']),
        total_pendiente: suma(['Pendiente', 'En revision']),
        total_rechazado: suma(['Rechazada']),
    };
};

// Fecha en hora de Argentina de un timestamp de la base (que está en UTC), para filtrar por rangos de fechas en SQL
const fechaLocalSql = (columna) => `((${columna} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`;
const aCentavosFactura = aCentavos;

module.exports = { fechaLocalSql, aCentavosFactura, ESTADOS, TRANSICIONES, MAX_MOTIVO, validarRevision, esFecha, validarRango, resumenFacturas, MAX_ITEMS, ESTADOS_ABIERTOS, NOTA_PAGO, claveItem, validarSeleccion, totalFactura, descripcionCuota, descripcionServicio, azarReferencia, referenciaFactura, datosBancarios };
