const bcrypt = require('bcryptjs');
const db = require('./src/config/database');

async function seed() {
    const salt = await bcrypt.genSalt(10);
    const users = [
        ['admin', await bcrypt.hash('admin123', salt), 'Administrador', 'admin'],
        ['docente', await bcrypt.hash('docente123', salt), 'Juan Docente', 'docente'],
        ['alumno', await bcrypt.hash('alumno123', salt), 'Pepe Alumno', 'alumno'],
        ['padre', await bcrypt.hash('padre123', salt), 'Carlos Padre', 'padre']
    ];
    for (const [username, password, nombre, rol] of users) {
        await db.query(
            `INSERT INTO users (username, password, nombre, rol) VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO NOTHING`,
            [username, password, nombre, rol]
        );
    }
    console.log('Usuarios de prueba creados.');

    // Niveles
    const niveles = ['Inicial', 'Primario', 'Secundario'];
    for (const nombre of niveles) {
        await db.query('INSERT INTO niveles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
    }

    // Aulas
    const aulas = [['Aula 101', 30], ['Aula 102', 30], ['Laboratorio de Ciencias', 20]];
    for (const [nombre, capacidad] of aulas) {
        await db.query('INSERT INTO aulas (nombre, capacidad) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING', [nombre, capacidad]);
    }

    // Instalaciones agendables (pileta, gimnasio, laboratorios).
    // Se siembran solo si la tabla está vacía para no duplicar en re-ejecuciones.
    const instalCount = await db.query('SELECT COUNT(*) as count FROM instalaciones');
    if (instalCount.rows[0].count === 0) {
        const instalaciones = [
            ['Pileta', 'Pileta climatizada para clases de natación'],
            ['Gimnasio', 'Gimnasio cubierto para educación física y deportes'],
            ['Laboratorio de Ciencias', 'Laboratorio equipado para física, química y biología'],
            ['Laboratorio de Informática', 'Sala de computación con equipamiento actualizado']
        ];
        for (const [nombre, descripcion] of instalaciones) {
            await db.query('INSERT INTO instalaciones (nombre, descripcion) VALUES ($1, $2)', [nombre, descripcion]);
        }
        console.log('Instalaciones iniciales creadas.');
    }

    // Datos de prueba (legajos, cursos, materias, cuotas, etc.).
    // Solo se cargan si todavía no hay alumnos, para no duplicar al re-ejecutar.
    const alumnosCount = await db.query('SELECT COUNT(*) as count FROM alumnos');
    if (alumnosCount.rows[0].count === 0) {
        await seedDatosPrueba();
    }

    // Catálogo demo de servicios facturables (HU4). Es idempotente: se puede repetir.
    await seedServicios();

    console.log('Datos académicos iniciales creados.');
}

// Catálogo demo para la app móvil y los reportes: grupos de deporte (cada uno con su profesor,
// nivel y horario), los cuatro recorridos del transporte y el comedor. Es idempotente.
// En producción el administrador los crea con POST /api/inscripciones/servicios.
async function seedServicios() {
    const una = async (sql, params = []) => (await db.query(sql, params)).rows[0] || null;

    // Los deportes (actividades) que todavía no existan
    for (const nombre of ['Natación', 'Vóley', 'Básquet']) {
        await db.query(
            `INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max)
             SELECT $1::text, 'Deporte', 'Ver grupos', 20
             WHERE NOT EXISTS (SELECT 1 FROM actividades_extra WHERE nombre = $1::text)`,
            [nombre]
        );
    }

    // Los cuatro recorridos del transporte (sin pasar del máximo si ya hay otros cargados)
    const recorridos = [['Ruta Centro', 'Carlos Suárez'], ['Ruta Norte', 'Marta Gómez'], ['Ruta Sur', 'Pablo Ríos'], ['Ruta Este', 'Laura Medina']];
    for (const [nombre, chofer] of recorridos) {
        await db.query(
            `INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max)
             SELECT $1::text, $2::text, 18
             WHERE NOT EXISTS (SELECT 1 FROM transporte_rutas WHERE nombre_ruta = $1::text)
               AND (SELECT COUNT(*) FROM transporte_rutas) < 4`,
            [nombre, chofer]
        );
    }

    // Grupos de deporte: necesitan docentes y niveles de la escuela
    const docentes = (await db.query("SELECT id FROM personal WHERE tipo = 'Docente' AND estado = 'Activo' ORDER BY id LIMIT 2")).rows.map((d) => d.id);
    if (docentes.length > 0) {
        const grupos = [
            // nombre, deporte, nivel, día, inicio, fin, profesor (0 o 1), precio, cupo
            ['Fútbol Primario · lunes 16:00', 'Fútbol', 'Primario', 1, '16:00', '17:30', 0, 6000, 20],
            ['Fútbol Secundario · miércoles 17:00', 'Fútbol', 'Secundario', 3, '17:00', '18:30', 0, 6000, 20],
            ['Natación Primario · martes 15:00', 'Natación', 'Primario', 2, '15:00', '16:00', 1, 9000, 15],
            ['Vóley Secundario · jueves 16:00', 'Vóley', 'Secundario', 4, '16:00', '17:30', 1, 5000, 15],
            ['Básquet Primario · viernes 16:00', 'Básquet', 'Primario', 5, '16:00', '17:30', 0, 5500, 15],
        ];
        for (const [nombre, deporte, nivel, dia, inicio, fin, docente, precio, cupo] of grupos) {
            const actividad = await una("SELECT id FROM actividades_extra WHERE nombre = $1 AND tipo = 'Deporte' ORDER BY id LIMIT 1", [deporte]);
            const niv = await una('SELECT id FROM niveles WHERE nombre = $1', [nivel]);
            if (!actividad || !niv) continue;
            await db.query(
                `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, actividad_id, nivel_id, docente_id, dia_semana, hora_inicio, hora_fin)
                 VALUES ('Deporte', $1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tipo, nombre) DO NOTHING`,
                [nombre, precio, cupo, actividad.id, niv.id, docentes[docente % docentes.length], dia, inicio, fin]
            );
        }
        // Los deportes del catálogo anterior no tenían profesor, nivel ni horario: se retiran de la oferta.
        await db.query("UPDATE servicios SET activo = FALSE WHERE tipo = 'Deporte' AND docente_id IS NULL");
    }

    // Un servicio de transporte por recorrido, y el comedor
    for (const [nombre] of recorridos) {
        const ruta = await una('SELECT id FROM transporte_rutas WHERE nombre_ruta = $1 ORDER BY id LIMIT 1', [nombre]);
        if (!ruta) continue;
        await db.query(
            `INSERT INTO servicios (tipo, nombre, precio_mensual, cupo_max, ruta_id)
             VALUES ('Transporte', $1, 12000, 18, $2) ON CONFLICT (tipo, nombre) DO NOTHING`,
            [nombre, ruta.id]
        );
    }
    await db.query(
        `INSERT INTO servicios (tipo, nombre, precio_mensual) VALUES ('Comedor', 'Comedor mensual', 25000)
         ON CONFLICT (tipo, nombre) DO NOTHING`
    );
    console.log('Catálogo de servicios creado.');
}

// Carga un set chico de datos de ejemplo para poder probar el sistema de inmediato.
async function seedDatosPrueba() {
    // Personal docente y no docente
    const personal = [
        ['María', 'González', '20111222', 'Docente', 'mgonzalez@educar.edu.ar', 'Matemática', '3624555111'],
        ['Jorge', 'Pérez', '20333444', 'Docente', 'jperez@educar.edu.ar', 'Lengua y Literatura', '3624555222'],
        ['Laura', 'Méndez', '20555666', 'Administrativo', 'lmendez@educar.edu.ar', null, '3624555333']
    ];
    for (const [nombre, apellido, dni, tipo, email, especialidad, telefono] of personal) {
        await db.query(
            `INSERT INTO personal (nombre, apellido, dni, tipo, email, especialidad, telefono, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activo')
             ON CONFLICT (dni) DO NOTHING`,
            [nombre, apellido, dni, tipo, email, especialidad, telefono]
        );
    }

    const nivelesResult = await db.query('SELECT id, nombre FROM niveles');
    const nivelId = (n) => (nivelesResult.rows.find(x => x.nombre === n) || {}).id;

    const crearCurso = async (nivel, division, cupo, materias, alumnos) => {
        const cursoResult = await db.query(
            'INSERT INTO cursos (nivel_id, division, cupo) VALUES ($1, $2, $3) RETURNING id',
            [nivelId(nivel), division, cupo]
        );
        const curso_id = cursoResult.rows[0].id;

        for (const m of materias) {
            await db.query('INSERT INTO materias (nombre, curso_id) VALUES ($1, $2)', [m, curso_id]);
        }
        for (const a of alumnos) {
            const [nombre, apellido, dni, fecha_nacimiento, domicilio, telefono, email] = a;
            await db.query(
                `INSERT INTO alumnos (nombre, apellido, dni, fecha_nacimiento, curso_id, domicilio, telefono, email, estado)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Activo')
                 ON CONFLICT (dni) DO NOTHING`,
                [nombre, apellido, dni, fecha_nacimiento, curso_id, domicilio, telefono, email]
            );
        }
    };

    await crearCurso('Primario', 'A', 25, ['Matemática', 'Lengua', 'Ciencias Naturales'], [
        ['Lucía', 'Fernández', '45111222', '2015-03-10', 'Av. 9 de Julio 123, Resistencia', '3624111222', 'lucia.fernandez@mail.com'],
        ['Mateo', 'Ramírez', '45333444', '2015-07-22', 'Belgrano 456, Resistencia', '3624333444', 'mateo.ramirez@mail.com']
    ]);
    await crearCurso('Secundario', 'A', 30, ['Historia', 'Biología', 'Matemática'], [
        ['Sofía', 'Torres', '44555666', '2010-01-15', 'San Martín 789, Resistencia', '3624555666', 'sofia.torres@mail.com'],
        ['Benjamín', 'Díaz', '44777888', '2010-09-05', 'Rivadavia 321, Resistencia', '3624777888', 'benjamin.diaz@mail.com']
    ]);

    // Configuración de cuotas por nivel
    await db.query(
        'INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5)',
        [nivelId('Primario'), 15000, 3, 2026, '2026-03-10']
    );
    await db.query(
        'INSERT INTO cuotas_config (nivel_id, monto, mes, anio, vencimiento) VALUES ($1, $2, $3, $4, $5)',
        [nivelId('Secundario'), 18000, 3, 2026, '2026-03-10']
    );

    // Actividades extracurriculares
    const actividades = [
        ['Fútbol', 'Deporte', 'Lun y Mié 16hs', 20],
        ['Inglés', 'Idioma', 'Mar y Jue 17hs', 15],
        ['Teatro', 'Cultura', 'Vie 15hs', 12]
    ];
    for (const [nombre, tipo, horario, cupo_max] of actividades) {
        await db.query(
            'INSERT INTO actividades_extra (nombre, tipo, horario, cupo_max) VALUES ($1, $2, $3, $4)',
            [nombre, tipo, horario, cupo_max]
        );
    }

    // Ruta de transporte
    await db.query(
        'INSERT INTO transporte_rutas (nombre_ruta, chofer_nombre, capacidad_max) VALUES ($1, $2, $3)',
        ['Ruta Centro', 'Carlos Suárez', 18]
    );

    // Preinscripción de ejemplo (pendiente)
    await db.query(
        `INSERT INTO preinscripciones (alumno_nombre, alumno_dni, alumno_edad, nivel, turno, tutor_nombre, tutor_telefono, tutor_email, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        ['Valentina Ruiz', '46999000', 6, 'Primario', 'Mañana', 'Marcela Ruiz', '3624111222', 'mruiz@mail.com', 'Hermana de alumno actual']
    );

    console.log('Datos de prueba creados.');
}

// Exportamos seed para poder llamarlo desde el arranque del servidor (index.js)
// sin disparar la siembra solo por importar el módulo.
module.exports = seed;

// Si se ejecuta directamente (`node seed.js`), sembrar una vez que database.js
// terminó de aplicar el esquema.
if (require.main === module) {
    db.ready
        .then(seed)
        .then(() => db.end())
        .catch((err) => {
            console.error('Error al sembrar:', err.message);
            process.exitCode = 1;
            return db.end();
        });
}
