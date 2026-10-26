// Ocupación de los recorridos de transporte.
//
// Un alumno viaja en un recorrido por dos caminos: la asignación que hace la administración (permanente, con punto de
// encuentro) y la inscripción mensual al servicio de transporte de ese recorrido. La ocupación cuenta a los alumnos de
// ambos caminos, sin repetir a quien figura en los dos.

// Ids de los alumnos que viajan en el recorrido en el mes indicado. `consulta` es (texto, parámetros) => promesa,
// para poder usarla dentro de una transacción.
async function ocupantesDeRuta(consulta, rutaId, mes, anio) {
    const r = await consulta(
        `SELECT alumno_id FROM transporte_asignaciones WHERE ruta_id = $1
         UNION
         SELECT i.alumno_id FROM inscripciones_servicio i
         JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Transporte'
         WHERE s.ruta_id = $1 AND i.estado = 'Activa' AND i.mes = $2 AND i.anio = $3`,
        [rutaId, mes, anio]
    );
    return r.rows.map((x) => x.alumno_id);
}

// Los recorridos con la cantidad de alumnos que viajan en cada uno en el mes indicado.
async function rutasConOcupacion(consulta, mes, anio) {
    const r = await consulta(
        `SELECT r.*,
                (SELECT COUNT(*)::int FROM (
                    SELECT alumno_id FROM transporte_asignaciones WHERE ruta_id = r.id
                    UNION
                    SELECT i.alumno_id FROM inscripciones_servicio i
                    JOIN servicios s ON s.id = i.servicio_id AND s.tipo = 'Transporte'
                    WHERE s.ruta_id = r.id AND i.estado = 'Activa' AND i.mes = $1 AND i.anio = $2
                ) u) AS ocupados
         FROM transporte_rutas r ORDER BY r.id`,
        [mes, anio]
    );
    return r.rows;
}

module.exports = { ocupantesDeRuta, rutasConOcupacion };
