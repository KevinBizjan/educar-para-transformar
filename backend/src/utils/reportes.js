// Utilidades de los reportes de la Dirección (ARTE-2): formato del legajo, armado de las respuestas y
// exportación a CSV. Son funciones puras, sin base de datos, para poder probarlas directamente.
const { nombreDia } = require('./deportes');

// Legajo = número de registro con prefijo: A-00012 (alumno), D-00005 (docente). Es estable y ordenable.
const legajo = (prefijo, id) => `${prefijo}-${String(id).padStart(5, '0')}`;

// El mismo legajo armado en SQL. LPAD recorta cuando el número es más largo que el ancho pedido, por eso el ancho
// nunca es menor que la cantidad de cifras (el alumno 123456 es A-123456, igual que en `legajo`).
// prefijoSql es una expresión SQL: "'A'" para alumnos, "'D'" para docentes.
const legajoSql = (prefijoSql, columna) => `${prefijoSql} || '-' || LPAD(${columna}::text, GREATEST(5, LENGTH(${columna}::text)), '0')`;
const legajoAlumnoSql = (columna) => legajoSql("'A'", columna);
const legajoDocenteSql = (columna) => legajoSql("'D'", columna);
// Personal: los docentes llevan D y el resto del personal (administrativos, directivos, maestranza), P.
const legajoPersonalSql = (columnaTipo, columna) => legajoSql(`CASE WHEN ${columnaTipo} = 'Docente' THEN 'D' ELSE 'P' END`, columna);

const diaCapitalizado = (dia) => {
    const nombre = nombreDia(dia);
    return nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
};

// Cada reporte responde lo mismo: una o más secciones, cada una con sus columnas y sus filas. Así la
// pantalla muestra todos con un único componente y el CSV sale del mismo formato.
const seccion = (titulo, columnas, filas) => ({
    titulo,
    columnas: columnas.map(([clave, tituloColumna]) => ({ clave, titulo: tituloColumna })),
    filas,
    total: filas.length,
});
const reporte = (titulo, secciones, filtros = {}) => ({ titulo, filtros, generado_en: new Date().toISOString(), secciones });

// Una celda de CSV: se escapa y, si empieza con =, +, - o @, se antepone un apóstrofe para que Excel
// no la interprete como una fórmula (un nombre cargado como "=HYPERLINK(...)" no debe ejecutarse).
const celdaCsv = (valor) => {
    if (valor === null || valor === undefined) return '';
    let texto = String(valor);
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
    texto = texto.replace(/"/g, '""');
    return /[",\n\r]/.test(texto) ? `"${texto}"` : texto;
};

// CSV del reporte completo: por cada sección, su título, los encabezados y las filas. Lleva BOM para
// que Excel respete los acentos.
const aCsv = (rep) => {
    const lineas = [celdaCsv(rep.titulo)];
    for (const sec of rep.secciones) {
        lineas.push('');
        if (rep.secciones.length > 1) lineas.push(celdaCsv(sec.titulo));
        lineas.push(sec.columnas.map((c) => celdaCsv(c.titulo)).join(','));
        for (const fila of sec.filas) lineas.push(sec.columnas.map((c) => celdaCsv(fila[c.clave])).join(','));
    }
    return '﻿' + lineas.join('\r\n') + '\r\n';
};

// Nombre del archivo de descarga: "alumnos-por-curso_2026-10-25.csv"
const nombreArchivo = (id, hoy = new Date()) => `${id}_${hoy.toISOString().slice(0, 10)}.csv`;

// Los reportes disponibles y los filtros que acepta cada uno (la pantalla se arma con esto).
const CATALOGO = [
    { id: 'alumno', titulo: 'Por alumno', descripcion: 'Curso, materias y profesores, deportes y horarios, transporte y comedor de un alumno.', filtros: [{ clave: 'alumno_id', tipo: 'alumno', obligatorio: true }, { clave: 'periodo', tipo: 'periodo' }] },
    { id: 'docente', titulo: 'Por docente', descripcion: 'Cursos a cargo por nivel y horarios de cada curso.', filtros: [{ clave: 'docente_id', tipo: 'docente', obligatorio: true }] },
    { id: 'alumnos-por-curso', titulo: 'Alumnos por curso', descripcion: 'Nivel educativo, curso, legajo, apellido y nombre.', filtros: [{ clave: 'nivel_id', tipo: 'nivel' }, { clave: 'curso_id', tipo: 'curso' }] },
    { id: 'alumnos-por-materia', titulo: 'Alumnos por materia', descripcion: 'Nivel educativo, curso, materia, profesor a cargo, alumno y legajo.', filtros: [{ clave: 'nivel_id', tipo: 'nivel' }, { clave: 'curso_id', tipo: 'curso' }, { clave: 'materia_id', tipo: 'materia' }] },
    { id: 'docentes-por-nivel', titulo: 'Docentes por nivel educativo', descripcion: 'Nivel educativo, profesor, materias a cargo y cursos.', filtros: [{ clave: 'nivel_id', tipo: 'nivel' }] },
    { id: 'alumnos-por-deporte', titulo: 'Alumnos por deporte', descripcion: 'Deporte, alumno, curso y nivel educativo.', filtros: [{ clave: 'actividad_id', tipo: 'deporte' }, { clave: 'periodo', tipo: 'periodo' }] },
    { id: 'alumnos-por-deporte-y-nivel', titulo: 'Alumnos por deporte y nivel', descripcion: 'Deporte, nivel del grupo, alumno y curso.', filtros: [{ clave: 'actividad_id', tipo: 'deporte' }, { clave: 'nivel_id', tipo: 'nivel' }, { clave: 'periodo', tipo: 'periodo' }] },
    { id: 'alumnos-por-deporte-nivel-horario', titulo: 'Alumnos por deporte, nivel, horario y profesor', descripcion: 'Deporte, nivel, horario, profesor a cargo, alumno y curso.', filtros: [{ clave: 'actividad_id', tipo: 'deporte' }, { clave: 'nivel_id', tipo: 'nivel' }, { clave: 'periodo', tipo: 'periodo' }] },
    { id: 'alumnos-por-recorrido', titulo: 'Alumnos por recorrido de transporte', descripcion: 'Recorrido, chofer, alumno, curso y punto de encuentro.', filtros: [{ clave: 'ruta_id', tipo: 'ruta' }, { clave: 'periodo', tipo: 'periodo' }] },
];

module.exports = { legajo, legajoSql, legajoAlumnoSql, legajoDocenteSql, legajoPersonalSql, diaCapitalizado, seccion, reporte, celdaCsv, aCsv, nombreArchivo, CATALOGO };
