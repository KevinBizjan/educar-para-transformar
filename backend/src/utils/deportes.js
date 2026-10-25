// Reglas puras de los deportes por grupo y del transporte. Un deporte (por ejemplo "Fútbol") tiene
// uno o más GRUPOS; cada grupo es un servicio con su nivel, su día y horario y su profesor a cargo.
// Son funciones sin base de datos para poder probarlas directamente.

// El servicio de transporte tiene cuatro recorridos.
const MAX_RECORRIDOS = 4;

const DIAS = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const nombreDia = (dia) => DIAS[dia] || '';

// Valida día y horas del grupo (HH:MM de 24 h, inicio anterior al fin). Devuelve '' si está bien.
const validarHorarioGrupo = (dia, inicio, fin) => {
    if (!Number.isInteger(dia) || dia < 1 || dia > 7) return 'El día debe estar entre 1 (lunes) y 7 (domingo).';
    if (!HORA.test(inicio || '') || !HORA.test(fin || '')) return 'Las horas deben tener formato HH:MM (24 h).';
    if (inicio >= fin) return 'La hora de inicio debe ser anterior a la hora de fin.';
    return '';
};

// Dos grupos chocan si son el mismo día y sus horarios se pisan (el borde compartido no cuenta:
// uno que termina a las 17:00 y otro que empieza a las 17:00 no chocan).
const seSuperponen = (a, b) => (
    a.dia_semana === b.dia_semana && a.hora_inicio < b.hora_fin && b.hora_inicio < a.hora_fin
);

// "lunes 16:00 a 17:00"
const describirHorario = (grupo) => `${nombreDia(grupo.dia_semana)} ${grupo.hora_inicio} a ${grupo.hora_fin}`;

module.exports = { MAX_RECORRIDOS, nombreDia, validarHorarioGrupo, seSuperponen, describirHorario };
