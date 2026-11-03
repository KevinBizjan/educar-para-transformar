// Reglas puras de las cuotas que ve el padre/tutor (HU6): estado de cada cuota, filtros y totales.
// Sin base de datos, para poder probarlas con Node.

const FILTROS = ['pendientes', 'pagadas', 'historial'];

// Los importes se comparan en centavos enteros: 0,1 + 0,2 no da 0,3 en coma flotante y un pago de 15.000
// no puede quedar "debiendo 0,00000001".
const aCentavos = (valor) => Math.round((Number(valor) || 0) * 100);
const deCentavos = (centavos) => centavos / 100;

// Fecha de hoy como AAAA-MM-DD en hora de Argentina (el servidor puede estar en UTC y adelantar el día).
const hoyEnArgentina = (ahora = new Date()) => ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

const comoFecha = (valor) => (/^\d{4}-\d{2}-\d{2}/.test(String(valor || '')) ? String(valor).slice(0, 10) : null);

// Pagada: lo abonado cubre el importe. En revisión: ya está en una factura con comprobantes por verificar.
// Vencida: sigue debiéndose y la fecha de vencimiento ya pasó. Pendiente: se debe y todavía no venció.
const estadoCuota = ({ monto, pagado, vencimiento, enRevision = false }, hoy = hoyEnArgentina()) => {
    if (Math.max(aCentavos(monto) - aCentavos(pagado), 0) === 0) return 'Pagada';
    if (enRevision) return 'En revision';
    const vence = comoFecha(vencimiento);
    return vence && vence < hoy ? 'Vencida' : 'Pendiente';
};

// Una fila de la consulta (cuota + lo abonado) como la ve la app. Si la cuota entró en una factura ya pagada,
// se considera cubierta aunque no haya un pago suelto registrado.
const armarCuota = (fila, hoy = hoyEnArgentina()) => {
    const monto = aCentavos(fila.monto);
    const pagado = fila.facturada_pagada ? monto : Math.min(aCentavos(fila.pagado), monto);
    return {
        cuota_id: fila.cuota_id,
        alumno_id: fila.alumno_id,
        alumno: `${fila.apellido}, ${fila.nombre}`,
        mes: fila.mes,
        anio: fila.anio,
        monto: deCentavos(monto),
        pagado: deCentavos(pagado),
        saldo: deCentavos(monto - pagado),
        vencimiento: comoFecha(fila.vencimiento),
        en_factura: fila.en_factura || null, // referencia de la factura abierta que ya la incluye (HU7)
        estado: estadoCuota({ monto: deCentavos(monto), pagado: deCentavos(pagado), vencimiento: fila.vencimiento, enRevision: fila.en_revision }, hoy),
    };
};

const filtrarCuotas = (cuotas, filtro) => cuotas.filter((c) => (filtro === 'pagadas' ? c.estado === 'Pagada' : c.estado !== 'Pagada'));
const sumar = (valores) => deCentavos(valores.reduce((total, v) => total + aCentavos(v), 0));
const totalPendiente = (cuotas) => sumar(cuotas.filter((c) => c.estado !== 'Pagada').map((c) => c.saldo));

module.exports = { FILTROS, aCentavos, hoyEnArgentina, estadoCuota, armarCuota, filtrarCuotas, sumar, totalPendiente };
