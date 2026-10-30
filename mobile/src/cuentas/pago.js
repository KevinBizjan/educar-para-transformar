// Lógica de la pantalla "Pagar" (HU7): elegir cuotas y servicios, ver el total y generar la factura para pagar
// por transferencia bancaria. Sin dependencias de React ni de Expo, para poder probarla con Node.
import { apiFetch } from '../api/client.js';

// Misma clave que usa el servidor para identificar cada ítem.
export const claveItem = (item) => (item.tipo === 'cuota' ? `cuota:${item.alumno_id}:${item.cuota_id}` : `servicio:${item.inscripcion_id}`);

// Los montos se suman en centavos enteros, igual que en el servidor.
const aCentavos = (valor) => Math.round((Number(valor) || 0) * 100);

// Agrega o quita un ítem de la selección sin modificar la anterior. Un ítem que no está disponible no se puede elegir.
export const alternarItem = (seleccion, item) => {
    if (!item.disponible) return seleccion;
    const nueva = new Set(seleccion);
    const clave = claveItem(item);
    if (nueva.has(clave)) nueva.delete(clave); else nueva.add(clave);
    return nueva;
};

// Solo cuentan los ítems elegidos que siguen disponibles (la lista pudo actualizarse mientras tanto).
export const itemsElegidos = (items, seleccion) => items.filter((i) => i.disponible && seleccion.has(claveItem(i)));
export const totalElegido = (items, seleccion) => itemsElegidos(items, seleccion).reduce((suma, i) => suma + aCentavos(i.monto), 0) / 100;

export const seleccionarTodo = (items) => new Set(items.filter((i) => i.disponible).map(claveItem));

// Lo único que se manda al servidor: qué ítems, nunca los montos (los calcula él).
export const itemsParaEnviar = (items, seleccion) => itemsElegidos(items, seleccion).map((i) => (
    i.tipo === 'cuota' ? { tipo: 'cuota', alumno_id: i.alumno_id, cuota_id: i.cuota_id } : { tipo: 'servicio', inscripcion_id: i.inscripcion_id }
));

// Agrupa por hijo conservando el orden en que vienen los ítems.
export const agruparItemsPorHijo = (items) => {
    const grupos = [];
    for (const item of items) {
        let grupo = grupos.find((g) => g.alumno_id === item.alumno_id);
        if (!grupo) { grupo = { alumno_id: item.alumno_id, alumno: item.alumno, items: [] }; grupos.push(grupo); }
        grupo.items.push(item);
    }
    return grupos;
};

const ESTADOS_FACTURA = { Pendiente: 'Pendiente de pago', 'En revision': 'En revisión', Pagada: 'Pagada', Rechazada: 'Rechazada' };
export const etiquetaFactura = (estado) => ESTADOS_FACTURA[estado] || estado;

export const colorFactura = (estado) => {
    if (estado === 'Pagada') return { fondo: '#dcfce7', texto: '#166534' };
    if (estado === 'En revision') return { fondo: '#fef3c7', texto: '#92400e' };
    if (estado === 'Rechazada') return { fondo: '#fee2e2', texto: '#991b1b' };
    return { fondo: '#e0f2fe', texto: '#075985' };
};

// Líneas con los datos para transferir. Si el servidor no los tiene configurados, se avisa dónde consultarlos.
export const lineasDatosBancarios = (datos) => {
    const lineas = [];
    if (datos) {
        if (datos.titular) lineas.push(`Titular: ${datos.titular}`);
        if (datos.banco) lineas.push(`Banco: ${datos.banco}`);
        if (datos.cbu) lineas.push(`CBU: ${datos.cbu}`);
        if (datos.alias) lineas.push(`Alias: ${datos.alias}`);
    }
    return lineas.length ? lineas : ['Consultá los datos bancarios en la institución.'];
};

export const cargarPagables = () => apiFetch('/api/cuentas/pagables');
export const cargarFacturas = () => apiFetch('/api/cuentas/facturas');
export const crearFactura = (items) => apiFetch('/api/cuentas/facturas', { metodo: 'POST', cuerpo: { items } });
