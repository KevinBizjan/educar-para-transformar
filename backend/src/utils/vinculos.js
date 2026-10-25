// Reglas puras de los vínculos entre cuentas y legajos, y de la inscripción de un hijo a un curso (ARTE-2, Sprint C).
// Son funciones sin base de datos para poder probarlas solas; los controladores aplican además lo que depende de los datos.

// Qué rol debe tener la cuenta que se vincula a cada tipo de legajo.
const ROL_DE_CUENTA = { alumno: 'alumno', docente: 'docente' };

// Lee el user_id del cuerpo del pedido: null/vacío = desvincular, un entero positivo = vincular.
// Devuelve undefined si el valor no sirve (para que el controlador responda 400).
const leerUserId = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    // Solo número o texto: Number(true) daría 1 y se vincularía la cuenta del primer usuario.
    if (typeof valor !== 'number' && typeof valor !== 'string') return undefined;
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : undefined;
};

// Mensaje de error si la cuenta no puede vincularse a ese tipo de legajo; '' si está bien.
const validarRolDeCuenta = (tipoLegajo, rolCuenta) => {
    const esperado = ROL_DE_CUENTA[tipoLegajo];
    if (!esperado) return 'Tipo de legajo inválido';
    if (rolCuenta !== esperado) return `La cuenta debe tener el rol "${esperado}" para vincularse a un ${tipoLegajo}`;
    return '';
};

// Vacantes que le quedan a un curso (nunca negativas).
const vacantes = (cupo, inscriptos) => Math.max(0, Number(cupo) - Number(inscriptos));

module.exports = { ROL_DE_CUENTA, leerUserId, validarRolDeCuenta, vacantes };
