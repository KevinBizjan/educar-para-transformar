// Cliente de la API REST del backend (el mismo que usa la web).
import { API_URL } from '../config.js';

// El plan gratuito de Render duerme el servicio tras 15 min sin tráfico y la primera
// respuesta puede tardar cerca de 1 minuto: el tiempo de espera por defecto lo contempla.
const TIEMPO_ESPERA_MS = 70000;

export class ApiError extends Error {
    constructor(mensaje, estado = 0, datos = null) {
        super(mensaje);
        this.name = 'ApiError';
        this.estado = estado; // código HTTP; 0 si no hubo respuesta
        this.datos = datos;
    }
}

// Token JWT de la sesión (lo define el login de la HU3).
let token = null;
export const setToken = (nuevo) => { token = nuevo || null; };

// Aviso para cerrar la sesión en la app cuando el servidor rechaza un token vencido o inválido
// (401 en una llamada que SÍ llevaba token; un login fallido no lo dispara).
let alExpirar = null;
export const alSesionExpirada = (funcion) => { alExpirar = funcion || null; };

export async function apiFetch(ruta, { metodo = 'GET', cuerpo, tiempoEsperaMs = TIEMPO_ESPERA_MS } = {}) {
    const tokenEnviado = token;
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), tiempoEsperaMs);
    try {
        const respuesta = await fetch(`${API_URL}${ruta}`, {
            method: metodo,
            headers: {
                'Content-Type': 'application/json',
                ...(tokenEnviado ? { Authorization: `Bearer ${tokenEnviado}` } : {}),
            },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: control.signal,
        });
        let datos = null;
        try { datos = await respuesta.json(); } catch { /* respuesta sin JSON */ }
        if (!respuesta.ok) {
            if (respuesta.status === 401 && tokenEnviado && alExpirar) alExpirar();
            throw new ApiError((datos && datos.message) || `Error ${respuesta.status} del servidor`, respuesta.status, datos);
        }
        return datos;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.name === 'AbortError') {
            throw new ApiError('El servidor tardó demasiado en responder. Reintentá en unos segundos.');
        }
        throw new ApiError('No hay conexión con el servidor. Revisá tu internet.');
    } finally {
        clearTimeout(temporizador);
    }
}

// Comprueba que la app llega al backend real (GET /api/health).
export async function verificarConexion() {
    const inicio = Date.now();
    const datos = await apiFetch('/api/health');
    return { mensaje: datos && datos.message, demoraMs: Date.now() - inicio, url: API_URL };
}
