// Reglas puras de los reportes de pagos de la Dirección (HU11 y HU12): estado de pago, período y totales.
// Sin base de datos, para poder probarlas con Node.
const { aCentavos } = require('./cuotas');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ESTADOS_PAGO = ['Completo', 'Incompleto'];
const CONCEPTOS = ['Cuotas', 'Deporte', 'Transporte', 'Comedor'];

// Completo: lo abonado cubre todo lo adeudado. Incompleto: falta algo (incluye a quien no pagó nada).
// Sin cargos: no tiene nada para pagar en el período.
const estadoPago = ({ adeudado, pagado }) => {
    const debe = aCentavos(adeudado);
    if (debe <= 0) return 'Sin cargos';
    return aCentavos(pagado) >= debe ? 'Completo' : 'Incompleto';
};

// Estado de un cargo (una cuota o un servicio) en el detalle de un alumno: pagado, parcial, en revisión o pendiente
const estadoCargo = ({ monto, pagado, enRevision }) => {
    if (aCentavos(pagado) >= aCentavos(monto)) return 'Pagado';
    if (aCentavos(pagado) > 0) return 'Parcial';
    return enRevision ? 'En revisión' : 'Pendiente';
};

// Estado de un servicio individual, según la factura en la que esté
const estadoServicio = ({ pagado, enRevision }) => {
    if (pagado) return 'Pagado';
    return enRevision ? 'En revisión' : 'Pendiente';
};

// Período de un reporte: el año escolar (por defecto, el actual) y, si se pide, un mes. Devuelve { anio, mes } o { error }.
const leerAnioMes = (query = {}, hoy = new Date()) => {
    const anio = query.anio === undefined || query.anio === '' ? hoy.getFullYear() : Number(query.anio);
    if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return { error: 'El año escolar tiene que estar entre 2020 y 2100' };
    if (query.mes === undefined || query.mes === '') return { anio, mes: null };
    const mes = Number(query.mes);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return { error: 'El mes tiene que estar entre 1 y 12' };
    return { anio, mes };
};

const leerEstadoPago = (valor) => {
    if (valor === undefined || valor === '') return { estado: null };
    return ESTADOS_PAGO.includes(valor) ? { estado: valor } : { error: `El estado de pago tiene que ser ${ESTADOS_PAGO.join(' o ')}` };
};

// Suma en centavos exactos una lista de números
const sumar = (valores) => valores.reduce((total, v) => total + aCentavos(v), 0) / 100;

// Texto del período para el título del reporte: "marzo de 2026" o "año 2026"
const describirPeriodo = ({ anio, mes }) => (mes ? `${MESES[mes - 1].toLowerCase()} de ${anio}` : `año ${anio}`);

module.exports = { MESES, ESTADOS_PAGO, CONCEPTOS, estadoPago, estadoCargo, estadoServicio, leerAnioMes, leerEstadoPago, sumar, describirPeriodo };
