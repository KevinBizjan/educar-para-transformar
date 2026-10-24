// Configuración del cliente móvil. Las variables EXPO_PUBLIC_* se incrustan en el build
// (ver .env.example). Nunca van contraseñas ni claves secretas acá.

// Backend desplegado en Render. En desarrollo local se reemplaza con EXPO_PUBLIC_API_URL
// (por ejemplo http://192.168.0.10:3000, la IP de la computadora en la red Wi-Fi).
const API_URL_POR_DEFECTO = 'https://educar-para-transformar-pfeu.onrender.com';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || API_URL_POR_DEFECTO).replace(/\/+$/, '');

// Supabase se usa SOLO para Storage (comprobantes de pago, HU8). La autenticación y
// los datos pasan siempre por la API REST del backend.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';
