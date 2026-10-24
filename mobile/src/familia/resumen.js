// Lógica de la pantalla "Mis hijos" (HU5): carga del resumen de la familia, caché y formatos.
// Sin dependencias de React ni de Expo, para poder probarla con Node.
import { apiFetch } from '../api/client.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const nombreMes = (mes) => MESES[mes - 1] || '';
export const periodoActual = (hoy = new Date()) => ({ mes: hoy.getMonth() + 1, anio: hoy.getFullYear() });
export const mesAnterior = ({ mes, anio }) => (mes === 1 ? { mes: 12, anio: anio - 1 } : { mes: mes - 1, anio });
export const mesSiguiente = ({ mes, anio }) => (mes === 12 ? { mes: 1, anio: anio + 1 } : { mes: mes + 1, anio });
export const tituloPeriodo = ({ mes, anio }) => {
    const nombre = nombreMes(mes);
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
};
const clave = ({ mes, anio }) => `${anio}-${mes}`;

// "$12.000" o "$15.000,50": punto para los miles y coma para los centavos (sin depender de Intl).
export const formatearMonto = (monto) => {
    const n = Number(monto) || 0;
    const negativo = n < 0;
    const [entero, decimales] = Math.abs(n).toFixed(2).split('.');
    const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const conDecimales = decimales === '00' ? miles : `${miles},${decimales}`;
    return `${negativo ? '-' : ''}$${conDecimales}`;
};

export const describirCurso = (hijo) => {
    const partes = [hijo.nivel, hijo.division].filter(Boolean);
    return partes.length ? partes.join(' ') : 'Sin curso asignado';
};

// "Deporte: Fútbol", pero "Comedor mensual" a secas (sin repetir el tipo cuando ya está en el nombre).
export const nombreServicio = (servicio) => (
    servicio.nombre.toLowerCase().startsWith(servicio.tipo.toLowerCase()) ? servicio.nombre : `${servicio.tipo}: ${servicio.nombre}`
);

// Texto del consumo real del comedor; null si no corresponde mostrarlo.
export const describirComedor = (comedor) => {
    if (!comedor || (!comedor.inscripto && comedor.dias_registrados === 0)) return null;
    if (comedor.dias_registrados === 0) return 'Comedor: todavía sin registros este mes';
    const registrados = comedor.dias_registrados === 1 ? '1 día registrado' : `${comedor.dias_registrados} días registrados`;
    return `Comedor: comió ${comedor.dias_consumidos} de ${registrados}`;
};

// --- Caché en memoria: la pantalla muestra al instante lo último que vio y lo actualiza en segundo plano ---
const cache = new Map();
export const obtenerEnCache = (periodo) => cache.get(clave(periodo)) || null;
export const limpiarCache = () => cache.clear(); // se llama al cerrar sesión: no deben quedar datos de la familia

export async function cargarResumen(periodo) {
    const datos = await apiFetch(`/api/inscripciones/resumen-familia?mes=${periodo.mes}&anio=${periodo.anio}`);
    cache.set(clave(periodo), datos);
    return datos;
}
