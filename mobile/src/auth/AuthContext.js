import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { crearSesion } from './sesion.js';
import { almacenSeguro } from './almacen.js';
import { alSesionExpirada } from '../api/client.js';
import { limpiarCache } from '../familia/resumen.js';
import { limpiarCacheCuotas } from '../cuentas/cuotas.js';

// Al cerrar la sesión no debe quedar ningún dato de la familia en memoria.
const limpiarDatosDeLaFamilia = () => { limpiarCache(); limpiarCacheCuotas(); };

// Mientras la app está abierta, se renueva el token cada 10 min (el token dura 30). Si pasan
// más de 30 min sin abrirla, el servidor lo rechaza y hay que iniciar sesión de nuevo.
const REFRESCO_MS = 10 * 60 * 1000;

const sesionApi = crearSesion(almacenSeguro);
const Contexto = createContext(null);

export const useAuth = () => useContext(Contexto);

export function AuthProvider({ children }) {
    const [usuario, setUsuario] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [aviso, setAviso] = useState('');

    // Al abrir: restaurar la sesión guardada y escuchar los vencimientos que informe la API.
    useEffect(() => {
        let activo = true;
        alSesionExpirada(() => {
            sesionApi.cerrarSesion();
            limpiarDatosDeLaFamilia();
            setUsuario(null);
            setAviso('Tu sesión venció. Iniciá sesión nuevamente.');
        });
        sesionApi.restaurarSesion()
            .then((s) => { if (activo && s) setUsuario(s.user); })
            .catch(() => {})
            .finally(() => { if (activo) setCargando(false); });
        return () => { activo = false; alSesionExpirada(null); };
    }, []);

    // Renovación del token mientras hay sesión: cada 10 min y al volver a primer plano.
    useEffect(() => {
        if (!usuario) return undefined;
        const renovar = () => sesionApi.refrescar().then((s) => setUsuario(s.user)).catch(() => {});
        const intervalo = setInterval(renovar, REFRESCO_MS);
        const suscripcion = AppState.addEventListener('change', (estado) => { if (estado === 'active') renovar(); });
        return () => { clearInterval(intervalo); suscripcion.remove(); };
    }, [usuario?.id]);

    const iniciarSesion = useCallback(async (nombreUsuario, password) => {
        const s = await sesionApi.iniciarSesion(nombreUsuario, password);
        setAviso('');
        setUsuario(s.user);
    }, []);

    const cerrarSesion = useCallback(async () => {
        await sesionApi.cerrarSesion();
        limpiarDatosDeLaFamilia();
        setUsuario(null);
        setAviso('');
    }, []);

    const valor = useMemo(() => ({
        usuario, cargando, aviso, iniciarSesion, cerrarSesion,
        cambiarPassword: sesionApi.cambiarPassword,
    }), [usuario, cargando, aviso, iniciarSesion, cerrarSesion]);

    return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
