// Reglas de negocio de las inscripciones a servicios (HU4). Son funciones puras para poder
// probarlas sin base de datos; el controlador las usa y además aplica los límites que
// dependen de los datos (cupos, deportes ya inscriptos).

// Un alumno puede estar en como máximo 2 deportes por mes.
const MAX_DEPORTES_POR_ALUMNO = 2;

// Valida el formato de mes y año (1 a 12, y un año razonable). Devuelve '' si está bien.
const validarMesAnio = (mes, anio) => {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return 'El mes debe estar entre 1 y 12.';
    if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return 'El año no es válido.';
    return '';
};

// Además del formato, no permite inscribir en un mes que ya pasó (el mes actual sí se acepta).
const validarPeriodoInscripcion = (mes, anio, hoy = new Date()) => {
    const formato = validarMesAnio(mes, anio);
    if (formato) return formato;
    const actual = hoy.getFullYear() * 12 + hoy.getMonth();
    if (anio * 12 + (mes - 1) < actual) return 'No se puede inscribir en un mes que ya pasó.';
    return '';
};

// Error de una regla de negocio: lleva el código HTTP con el que se responde.
class ReglaError extends Error {
    constructor(estado, mensaje) {
        super(mensaje);
        this.estado = estado;
    }
}

module.exports = { MAX_DEPORTES_POR_ALUMNO, validarMesAnio, validarPeriodoInscripcion, ReglaError };
