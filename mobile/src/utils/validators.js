// Mismas reglas de contraseña que el backend (backend/src/utils/validators.js) y la web.
// El servidor vuelve a validar: esto solo evita viajes innecesarios a la red.
export const validarPassword = (password) => {
    if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una mayúscula.';
    if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial (ej: ! @ # $).';
    return '';
};

// Devuelve el mensaje de error del formulario de cambio de contraseña, o '' si está bien.
export const validarCambioPassword = (actual, nueva, repetida) => {
    if (!actual || !nueva || !repetida) return 'Completá los tres campos.';
    const error = validarPassword(nueva);
    if (error) return error;
    if (nueva !== repetida) return 'La contraseña nueva y su repetición no coinciden.';
    if (nueva === actual) return 'La contraseña nueva debe ser distinta de la actual.';
    return '';
};
