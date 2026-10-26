// Reglas puras de los servicios de la escuela que se gestionan desde la web (transporte y comedor), ARTE-2 Sprint D.
// Son funciones sin base de datos para poder probarlas solas; los controladores aplican además lo que depende de los datos.

const MAX_PUNTO_ENCUENTRO = 120;
const MAX_OBSERVACIONES = 300;

// Entero positivo del pedido (acepta número o texto numérico). Devuelve null si no sirve.
const leerId = (valor) => {
    if (typeof valor !== 'number' && typeof valor !== 'string') return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
};

// ¿Hay lugar en el recorrido? Sin capacidad definida no hay límite, y quien ya viaja en él no ocupa un lugar nuevo.
const hayLugarEnRuta = (capacidad, ocupados, yaViajaEnLaRuta) =>
    capacidad === null || capacidad === undefined || yaViajaEnLaRuta === true || ocupados < capacidad;

// "¿Consumió el menú?" del pedido: el panel docente manda 1/0 y la API acepta además true/false.
// Sin dato se toma como que sí consumió (es lo habitual). Devuelve undefined si el valor no sirve.
const leerConsumioMenu = (valor) => {
    if (valor === undefined || valor === null || valor === '') return true;
    if (valor === true || valor === 1 || valor === '1' || valor === 'true') return true;
    if (valor === false || valor === 0 || valor === '0' || valor === 'false') return false;
    return undefined;
};

module.exports = { MAX_PUNTO_ENCUENTRO, MAX_OBSERVACIONES, leerId, hayLugarEnRuta, leerConsumioMenu };
