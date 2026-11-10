// Inscripción de los hijos a deportes, transporte y comedor desde la app. Las reglas (máximo de deportes, cupos,
// horarios, un recorrido por mes) las controla el servidor; acá se arma la lista que se muestra y se llama a la API.
// Sin React ni Expo, para poder probarla con Node.
import { apiFetch } from '../api/client.js';
import { periodoActual, mesSiguiente, tituloPeriodo, formatearMonto, limpiarCache } from './resumen.js';

// Solo se puede inscribir en el mes actual o en el siguiente (un mes que ya pasó lo rechaza el servidor)
export const PERIODOS = [
    { id: 'actual', texto: 'Este mes' },
    { id: 'siguiente', texto: 'Mes siguiente' },
];

export const periodoElegido = (id, hoy = new Date()) => {
    const actual = periodoActual(hoy);
    return id === 'siguiente' ? mesSiguiente(actual) : actual;
};

export { tituloPeriodo };

const DIAS = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };

const TITULOS = { Deporte: 'Deportes', Transporte: 'Transporte', Comedor: 'Comedor' };

// Agrupa el catálogo por tipo, en el orden Deportes, Transporte y Comedor, sin mostrar grupos vacíos
export const agruparCatalogo = (servicios) => Object.keys(TITULOS)
    .map((tipo) => ({ tipo, titulo: TITULOS[tipo], servicios: servicios.filter((s) => s.tipo === tipo) }))
    .filter((g) => g.servicios.length > 0);

// "Fútbol · Primario", o el nombre a secas si no es un deporte
export const tituloServicio = (servicio) => (
    servicio.tipo === 'Deporte' && servicio.deporte ? [servicio.deporte, servicio.nivel].filter(Boolean).join(' · ') : servicio.nombre
);

// Líneas de detalle del servicio: horario y profesor del deporte, y el precio mensual
export const detalleServicio = (servicio) => {
    const lineas = [];
    if (servicio.tipo === 'Deporte') {
        if (servicio.dia_semana) lineas.push(`${DIAS[servicio.dia_semana] || ''} ${servicio.hora_inicio} a ${servicio.hora_fin}`.replace(/^./, (c) => c.toUpperCase()));
        if (servicio.docente) lineas.push(`Profesor: ${servicio.docente}`);
    }
    lineas.push(`${formatearMonto(servicio.precio_mensual)} por mes`);
    return lineas;
};

// Cupo del mes: null = sin límite; 0 = completo
export const describirCupo = (servicio) => {
    if (servicio.cupo_disponible === null || servicio.cupo_disponible === undefined) return 'Sin límite de lugares';
    if (servicio.cupo_disponible === 0) return 'Sin lugares disponibles';
    return servicio.cupo_disponible === 1 ? 'Queda 1 lugar' : `Quedan ${servicio.cupo_disponible} lugares`;
};

// La inscripción activa del hijo a ese servicio, si la hay
export const inscripcionDe = (servicio, inscripciones) => inscripciones.find((i) => i.servicio_id === servicio.id) || null;

// Qué botón se muestra: dar de baja si ya está inscripto, inscribir si hay lugar y nada si el cupo está completo
export const accionDe = (servicio, inscripciones) => {
    if (inscripcionDe(servicio, inscripciones)) return 'baja';
    if (servicio.cupo_disponible === 0) return 'completo';
    return 'inscribir';
};

// Los lugares que el hijo ya ocupa se muestran primero dentro de cada grupo
export const ordenarServicios = (servicios, inscripciones) => [...servicios].sort((a, b) => (
    Number(Boolean(inscripcionDe(b, inscripciones))) - Number(Boolean(inscripcionDe(a, inscripciones)))
));

export const cargarCatalogo = ({ mes, anio }) => apiFetch(`/api/inscripciones/catalogo?mes=${mes}&anio=${anio}`);
export const cargarInscripciones = (alumnoId, { mes, anio }) => apiFetch(`/api/inscripciones/alumno/${alumnoId}?mes=${mes}&anio=${anio}`);

// Después de inscribir o dar de baja, "Mis hijos" tiene que volver a pedir sus datos: se borra el caché
export async function inscribir({ alumnoId, servicioId, mes, anio }) {
    const r = await apiFetch('/api/inscripciones', { metodo: 'POST', cuerpo: { alumno_id: alumnoId, servicio_id: servicioId, mes, anio } });
    limpiarCache();
    return r;
}

export async function darDeBaja(inscripcionId) {
    const r = await apiFetch(`/api/inscripciones/${inscripcionId}`, { metodo: 'DELETE' });
    limpiarCache();
    return r;
}
