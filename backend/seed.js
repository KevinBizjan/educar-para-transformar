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

    console.log('Datos académicos iniciales creados.');
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
