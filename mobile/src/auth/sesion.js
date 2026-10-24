// Lógica de la sesión de la app móvil. No depende de React ni de Expo: el almacenamiento se
// inyecta, así se puede probar con Node (en el celular es SecureStore, ver almacen.js).
//
// Usa los mismos endpoints y la misma tabla de usuarios que la web: no hay credenciales propias.
import { apiFetch, setToken, ApiError } from '../api/client.js';

const CLAVE = 'educar.sesion';

// La app móvil es para padres y tutores. El resto de los roles tiene acceso al portal web.
export const pantallaPorRol = (rol) => (rol === 'padre' ? 'inicio' : 'sin-acceso');

export function crearSesion(almacen) {
    const guardar = async (token, user) => {
        setToken(token);
        await almacen.guardar(CLAVE, JSON.stringify({ token, user }));
        return { token, user };
    };

    const cerrarSesion = async () => {
        setToken(null);
        await almacen.borrar(CLAVE);
    };

    return {
        // POST /api/auth/login
        async iniciarSesion(usuario, password) {
            const datos = await apiFetch('/api/auth/login', { metodo: 'POST', cuerpo: { username: usuario, password } });
            return guardar(datos.token, datos.user);
        },

        // Al abrir la app: si hay una sesión guardada, la renueva. Si el servidor la rechaza
        // (vencida o cuenta borrada) se descarta; si solo falla la red, se conserva.
        async restaurarSesion() {
            const crudo = await almacen.leer(CLAVE);
            if (!crudo) return null;
            let guardada;
            try { guardada = JSON.parse(crudo); } catch { guardada = null; }
            if (!guardada || !guardada.token) {
                await almacen.borrar(CLAVE);
                return null;
            }
            setToken(guardada.token);
            try {
                const datos = await apiFetch('/api/auth/refresh', { metodo: 'POST' });
                return guardar(datos.token, datos.user);
            } catch (error) {
                if (error instanceof ApiError && (error.estado === 401 || error.estado === 403)) {
                    await cerrarSesion();
                    return null;
                }
                return guardada; // sin conexión: se mantiene la sesión y se reintenta luego
            }
        },

        // POST /api/auth/refresh: renueva el token mientras la sesión está activa.
        async refrescar() {
            const datos = await apiFetch('/api/auth/refresh', { metodo: 'POST' });
            return guardar(datos.token, datos.user);
        },

        cerrarSesion,

        // POST /api/auth/change-password (usuario autenticado)
        cambiarPassword(passwordActual, passwordNueva) {
            return apiFetch('/api/auth/change-password', {
                metodo: 'POST',
                cuerpo: { password_actual: passwordActual, password_nueva: passwordNueva },
            });
        },
    };
}

// Almacenamiento en memoria: para las pruebas.
export function almacenMemoria() {
    const datos = new Map();
    return {
        guardar: async (clave, valor) => { datos.set(clave, valor); },
        leer: async (clave) => (datos.has(clave) ? datos.get(clave) : null),
        borrar: async (clave) => { datos.delete(clave); },
    };
}
