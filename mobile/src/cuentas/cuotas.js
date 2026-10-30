// Lógica de la pantalla "Cuotas" (HU6): carga, caché y textos de cada cuota y pago.
// Sin dependencias de React ni de Expo, para poder probarla con Node.
import { apiFetch } from '../api/client.js';
import { nombreMes } from '../familia/resumen.js';

export const FILTROS = [
    { id: 'pendientes', texto: 'Pendientes' },
    { id: 'pagadas', texto: 'Pagadas' },
    { id: 'historial', texto: 'Historial' },
];

const mayuscula = (texto) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
const dosDigitos = (n) => String(n).padStart(2, '0');

// "2026-03-10" -> "10/03/2026". Una fecha vacía o inválida se muestra como guion.
export const formatearFecha = (fecha) => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ''));
    return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '-';
};

// Momento exacto de un pago (el servidor lo manda en UTC) en hora de Argentina (UTC-3, sin horario de verano).
export const formatearMomento = (iso) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '-';
    const d = new Date(t - 3 * 3600 * 1000);
    return `${dosDigitos(d.getUTCDate())}/${dosDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dosDigitos(d.getUTCHours())}:${dosDigitos(d.getUTCMinutes())}`;
};

export const tituloCuota = (cuota) => `Cuota de ${mayuscula(nombreMes(cuota.mes))} ${cuota.anio}`;

const ETIQUETAS = { Pagada: 'Pagada', 'En revision': 'En revisión', Vencida: 'Vencida', Pendiente: 'Pendiente' };
export const etiquetaEstado = (estado) => ETIQUETAS[estado] || estado;

// Colores de la insignia de cada estado.
export const colorEstado = (estado) => {
    if (estado === 'Pagada') return { fondo: '#dcfce7', texto: '#166534' };
    if (estado === 'En revision') return { fondo: '#fef3c7', texto: '#92400e' };
    if (estado === 'Vencida') return { fondo: '#fee2e2', texto: '#991b1b' };
    return { fondo: '#e0f2fe', texto: '#075985' };
};

export const describirVencimiento = (cuota) => {
    if (cuota.estado === 'Pagada') return 'Pagada';
    if (cuota.estado === 'En revision') return 'Pago en revisión';
    return `${cuota.estado === 'Vencida' ? 'Venció' : 'Vence'} el ${formatearFecha(cuota.vencimiento)}`;
};

// Cuánto se abonó cuando el pago es parcial; null si no corresponde mostrarlo.
export const describirAbonado = (cuota, formatearMonto) => (
    cuota.estado !== 'Pagada' && cuota.pagado > 0 ? `Abonado ${formatearMonto(cuota.pagado)} · Resta ${formatearMonto(cuota.saldo)}` : null
);

// Qué se muestra cuando la lista está vacía. Sin deuda es una buena noticia, no un error.
export const mensajeVacio = (filtro) => {
    if (filtro === 'pagadas') return 'Todavía no hay cuotas pagadas.';
    if (filtro === 'historial') return 'Todavía no hay pagos registrados.';
    return '¡Estás al día! No tenés cuotas pendientes.';
};

// Agrupa por hijo conservando el orden en que vienen las cuotas (de la más nueva a la más vieja).
export const agruparPorHijo = (cuotas) => {
    const grupos = [];
    for (const cuota of cuotas) {
        let grupo = grupos.find((g) => g.alumno_id === cuota.alumno_id);
        if (!grupo) { grupo = { alumno_id: cuota.alumno_id, alumno: cuota.alumno, cuotas: [] }; grupos.push(grupo); }
        grupo.cuotas.push(cuota);
    }
    return grupos;
};

// Descripción de un pago del historial: de qué cuota fue y con qué método.
export const describirPago = (pago) => {
    const cuota = pago.cuota_mes ? `Cuota de ${mayuscula(nombreMes(pago.cuota_mes))} ${pago.cuota_anio}` : 'Pago';
    return pago.metodo_pago ? `${cuota} · ${pago.metodo_pago}` : cuota;
};

// --- Caché en memoria: la pantalla muestra al instante lo último que vio y lo actualiza en segundo plano ---
const cache = new Map();
export const obtenerEnCacheCuotas = (filtro) => cache.get(filtro) || null;
export const limpiarCacheCuotas = () => cache.clear(); // se llama al cerrar sesión: no deben quedar datos de la familia

export async function cargarCuotas(filtro) {
    const datos = await apiFetch(`/api/cuentas/cuotas?estado=${filtro}`);
    cache.set(filtro, datos);
    return datos;
}
