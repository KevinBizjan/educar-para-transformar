// Recuperación de contraseña por correo: validaciones del formulario y llamadas a la API. Sin React ni Expo, para
// poder probarla con Node. El servidor vuelve a validar todo; acá solo se evitan viajes innecesarios a la red.
import { apiFetch } from '../api/client.js';
import { validarPassword } from '../utils/validators.js';

export const LARGO_CODIGO = 6;

const esCorreo = (texto) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(texto || '').trim());

// Paso 1: pedir el código. Devuelve el mensaje de error o '' si está bien.
export const validarPedido = (correo) => {
    if (!String(correo || '').trim()) return 'Escribí el correo de tu cuenta.';
    if (!esCorreo(correo)) return 'Ingresá un correo válido (por ejemplo, nombre@correo.com).';
    return '';
};

// Paso 2: el código que llegó por correo y la contraseña nueva
export const validarRestablecer = ({ codigo, password, repetida }) => {
    if (!codigo || !password || !repetida) return 'Completá el código y la contraseña nueva dos veces.';
    if (!new RegExp(`^\\d{${LARGO_CODIGO}}$`).test(String(codigo).trim())) return `El código tiene ${LARGO_CODIGO} dígitos.`;
    const error = validarPassword(password);
    if (error) return error;
    if (password !== repetida) return 'La contraseña nueva y su repetición no coinciden.';
    return '';
};

// Deja solo los dígitos y recorta al largo del código (el usuario puede pegar "123 456" o con espacios)
export const normalizarCodigo = (texto) => String(texto || '').replace(/\D/g, '').slice(0, LARGO_CODIGO);

export const pedirCodigo = (correo) => apiFetch('/api/auth/recuperar', { metodo: 'POST', cuerpo: { usuario: String(correo).trim().toLowerCase() } });

export const restablecerPassword = ({ correo, codigo, password }) => apiFetch('/api/auth/restablecer', {
    metodo: 'POST', cuerpo: { usuario: String(correo).trim().toLowerCase(), codigo: String(codigo).trim(), password },
});
