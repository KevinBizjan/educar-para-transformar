-- Esquema PostgreSQL (Supabase) para Educar para Transformar.
-- Traducido desde el esquema SQLite original (database.js).
-- Se ejecuta una sola vez (o con CREATE TABLE IF NOT EXISTS, es re-ejecutable).

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'docente', 'alumno', 'padre')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preinscripciones (
    id SERIAL PRIMARY KEY,
    alumno_nombre TEXT NOT NULL,
    alumno_dni TEXT,
    alumno_edad INTEGER NOT NULL,
    nivel TEXT NOT NULL,
    turno TEXT NOT NULL,
    tutor_nombre TEXT NOT NULL,
    tutor_telefono TEXT NOT NULL,
    tutor_email TEXT NOT NULL,
    observaciones TEXT,
    estado TEXT DEFAULT 'pendiente',
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- --- Núcleo académico ---

CREATE TABLE IF NOT EXISTS niveles (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS aulas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    capacidad INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cursos (
    id SERIAL PRIMARY KEY,
    nivel_id INTEGER REFERENCES niveles(id),
    division TEXT NOT NULL,
    cupo INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alumnos (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    dni TEXT UNIQUE NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    curso_id INTEGER REFERENCES cursos(id),
    tutor_id INTEGER REFERENCES users(id),
    domicilio TEXT,
    telefono TEXT,
    email TEXT,
    estado TEXT DEFAULT 'Activo'
);

CREATE TABLE IF NOT EXISTS personal (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    dni TEXT UNIQUE NOT NULL,
    tipo TEXT CHECK (tipo IN ('Docente', 'Administrativo', 'Maestranza', 'Directivo')),
    email TEXT,
    fecha_alta DATE DEFAULT CURRENT_DATE,
    especialidad TEXT,
    telefono TEXT,
    estado TEXT DEFAULT 'Activo'
);

CREATE TABLE IF NOT EXISTS materias (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    curso_id INTEGER REFERENCES cursos(id)
);

-- NOTA (fix de integridad respecto al esquema SQLite original):
-- docente_id referencia personal(id), NO una tabla "docentes" separada.
-- El código de la app (academico.controller.js getDocentes/getHorarios) ya
-- usa la tabla `personal` filtrada por tipo='Docente' como fuente de docentes;
-- la vieja tabla `docentes` estaba definida en el esquema pero no la usa
-- ningún controlador, así que se elimina para no dejar una FK que nunca
-- coincide con los datos reales.
CREATE TABLE IF NOT EXISTS horarios (
    id SERIAL PRIMARY KEY,
    materia_id INTEGER REFERENCES materias(id),
    docente_id INTEGER REFERENCES personal(id),
    aula_id INTEGER REFERENCES aulas(id),
    dia_semana INTEGER,
    hora_inicio TEXT,
    hora_fin TEXT
);

CREATE TABLE IF NOT EXISTS asistencias (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    fecha DATE DEFAULT CURRENT_DATE,
    estado TEXT CHECK (estado IN ('Presente', 'Ausente', 'Tarde')),
    materia_id INTEGER REFERENCES materias(id)
);

CREATE TABLE IF NOT EXISTS calificaciones (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    materia_id INTEGER REFERENCES materias(id),
    nota INTEGER CHECK (nota >= 1 AND nota <= 10),
    trimestre INTEGER
);

-- --- Gestión administrativa y financiera ---

CREATE TABLE IF NOT EXISTS cuotas_config (
    id SERIAL PRIMARY KEY,
    nivel_id INTEGER REFERENCES niveles(id),
    monto DECIMAL(10,2) NOT NULL,
    mes INTEGER,
    anio INTEGER,
    vencimiento DATE
);

CREATE TABLE IF NOT EXISTS pagos (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    cuota_id INTEGER REFERENCES cuotas_config(id),
    monto_pagado DECIMAL(10,2) NOT NULL,
    fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metodo_pago TEXT,
    comprobante_url TEXT
);

CREATE TABLE IF NOT EXISTS saldos_alumnos (
    alumno_id INTEGER PRIMARY KEY REFERENCES alumnos(id),
    saldo_pendiente DECIMAL(10,2) DEFAULT 0,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- --- Servicios institucionales ---

CREATE TABLE IF NOT EXISTS comedor_asistencias (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    fecha DATE DEFAULT CURRENT_DATE,
    consumio_menu BOOLEAN DEFAULT TRUE,
    observaciones TEXT
);

CREATE TABLE IF NOT EXISTS transporte_rutas (
    id SERIAL PRIMARY KEY,
    nombre_ruta TEXT NOT NULL,
    chofer_nombre TEXT,
    capacidad_max INTEGER
);

CREATE TABLE IF NOT EXISTS transporte_asignaciones (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    ruta_id INTEGER REFERENCES transporte_rutas(id),
    punto_encuentro TEXT
);

CREATE TABLE IF NOT EXISTS instalaciones (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS instalaciones_reservas (
    id SERIAL PRIMARY KEY,
    instalacion_id INTEGER REFERENCES instalaciones(id),
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    reservado_por INTEGER REFERENCES users(id),
    motivo TEXT
);

CREATE TABLE IF NOT EXISTS enfermeria_incidencias (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES alumnos(id),
    descripcion TEXT NOT NULL CHECK (length(descripcion) >= 10),
    accion_tomada TEXT,
    notificado_padre BOOLEAN DEFAULT FALSE,
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- --- Extracurriculares, comunicación y reportes ---

CREATE TABLE IF NOT EXISTS actividades_extra (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT CHECK (tipo IN ('Deporte', 'Cultura', 'Idioma')),
    horario TEXT,
    cupo_max INTEGER
);

-- NOTA (fix de integridad): alumno_id referencia users(id), no alumnos(id).
-- El alumno se autoinscribe con su propia cuenta (req.user.id en
-- academico.controller.js inscribirActividad), no con el id de su legajo.
-- Mismo criterio aplica a actividad_asistencias y actividad_calificaciones.
CREATE TABLE IF NOT EXISTS inscripciones_extra (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER REFERENCES users(id),
    actividad_id INTEGER REFERENCES actividades_extra(id),
    fecha_inscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notificaciones (
    id SERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    rol_destino TEXT,
    leido BOOLEAN DEFAULT FALSE,
    fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS actividad_asistencias (
    id SERIAL PRIMARY KEY,
    actividad_id INTEGER REFERENCES actividades_extra(id),
    alumno_id INTEGER REFERENCES users(id),
    fecha DATE DEFAULT CURRENT_DATE,
    estado TEXT CHECK (estado IN ('Presente', 'Ausente', 'Tarde'))
);

CREATE TABLE IF NOT EXISTS actividad_calificaciones (
    id SERIAL PRIMARY KEY,
    actividad_id INTEGER REFERENCES actividades_extra(id),
    alumno_id INTEGER REFERENCES users(id),
    nota INTEGER CHECK (nota >= 1 AND nota <= 10),
    fecha DATE DEFAULT CURRENT_DATE
);

-- --- Migración incremental: datos de contacto y estado de legajos ---
-- Agregado después de la migración inicial a Postgres (Módulo Alumnos /
-- Módulo Profesores). Usa ADD COLUMN/CONSTRAINT IF NOT EXISTS para que sea
-- seguro de re-ejecutar tanto en una base nueva (creada con el CREATE TABLE
-- de arriba) como en la base ya migrada de Supabase.
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS domicilio TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activo';
ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS alumnos_estado_check;
ALTER TABLE alumnos ADD CONSTRAINT alumnos_estado_check CHECK (estado IN ('Activo', 'Inactivo', 'Egresado'));

ALTER TABLE personal ADD COLUMN IF NOT EXISTS especialidad TEXT;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activo';
ALTER TABLE personal DROP CONSTRAINT IF EXISTS personal_estado_check;
ALTER TABLE personal ADD CONSTRAINT personal_estado_check CHECK (estado IN ('Activo', 'Inactivo', 'Licencia'));

-- --- Asistencia por materia: un solo registro por alumno, día y materia (HU1) ---
-- materia_id es opcional: NULL = asistencia general del día (sin materia).
-- El índice trata NULL como una materia más (COALESCE) porque, de otro modo,
-- Postgres permitiría duplicar los registros "generales". Se eliminan antes los
-- duplicados exactos que pudieran existir (se conserva el más reciente).
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS materia_id INTEGER REFERENCES materias(id);
DROP INDEX IF EXISTS asistencias_alumno_fecha_uq;
DELETE FROM asistencias a USING asistencias b
    WHERE a.alumno_id = b.alumno_id AND a.fecha = b.fecha
      AND COALESCE(a.materia_id, 0) = COALESCE(b.materia_id, 0) AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS asistencias_alumno_fecha_materia_uq
    ON asistencias (alumno_id, fecha, (COALESCE(materia_id, 0)));

-- --- App móvil (Parte 3, HU1): facturación consolidada, servicios e inscripciones ---
-- Tablas NUEVAS: no modifican cuotas_config, pagos ni saldos_alumnos (módulo web).
-- Los CHECK y las claves foráneas rechazan datos o relaciones inválidas desde la base.

-- Catálogo de servicios que se facturan a las familias.
CREATE TABLE IF NOT EXISTS servicios (
    id SERIAL PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('Deporte', 'Transporte', 'Comedor')),
    nombre TEXT NOT NULL,
    precio_mensual DECIMAL(10,2) NOT NULL CHECK (precio_mensual > 0),
    cupo_max INTEGER CHECK (cupo_max IS NULL OR cupo_max > 0),
    actividad_id INTEGER REFERENCES actividades_extra(id),
    ruta_id INTEGER REFERENCES transporte_rutas(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (actividad_id IS NULL OR tipo = 'Deporte'),
    CHECK (ruta_id IS NULL OR tipo = 'Transporte'),
    UNIQUE (tipo, nombre)
);

-- Deportes por GRUPO: un deporte (actividades_extra) tiene grupos según nivel y horario, y cada
-- grupo tiene un profesor a cargo. Cada grupo es un servicio de tipo Deporte con estas columnas
-- (en los demás tipos quedan vacías). Las reglas de obligatoriedad las valida la API.
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS docente_id INTEGER REFERENCES personal(id);
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS nivel_id INTEGER REFERENCES niveles(id);
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS dia_semana INTEGER;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS hora_inicio TEXT;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS hora_fin TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicios_horario_chk' AND conrelid = 'servicios'::regclass) THEN
        ALTER TABLE servicios ADD CONSTRAINT servicios_horario_chk CHECK (
            (dia_semana IS NULL AND hora_inicio IS NULL AND hora_fin IS NULL)
            OR (dia_semana BETWEEN 1 AND 7
                AND hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                AND hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                AND hora_inicio < hora_fin)
        );
    END IF;
END $$;

-- Inscripción de un alumno a un servicio en un mes (el transporte puede variar mes a mes).
CREATE TABLE IF NOT EXISTS inscripciones_servicio (
    id SERIAL PRIMARY KEY,
    alumno_id INTEGER NOT NULL REFERENCES alumnos(id),
    servicio_id INTEGER NOT NULL REFERENCES servicios(id),
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    anio INTEGER NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
    estado TEXT NOT NULL DEFAULT 'Activa' CHECK (estado IN ('Activa', 'Baja')),
    creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (alumno_id, servicio_id, mes, anio)
);

-- Factura consolidada de un padre/tutor, con una referencia de pago para la transferencia.
CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY,
    tutor_id INTEGER NOT NULL REFERENCES users(id),
    referencia TEXT NOT NULL UNIQUE,
    total DECIMAL(10,2) NOT NULL CHECK (total > 0),
    estado TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'En revision', 'Pagada', 'Rechazada')),
    emitida_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pagada_en TIMESTAMP
);

-- Renglones de la factura: cada uno es una cuota O una inscripción a un servicio.
CREATE TABLE IF NOT EXISTS factura_items (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    alumno_id INTEGER NOT NULL REFERENCES alumnos(id),
    cuota_id INTEGER REFERENCES cuotas_config(id),
    inscripcion_id INTEGER REFERENCES inscripciones_servicio(id),
    descripcion TEXT NOT NULL,
    monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
    CHECK ((cuota_id IS NOT NULL AND inscripcion_id IS NULL) OR (cuota_id IS NULL AND inscripcion_id IS NOT NULL))
);

-- Comprobantes de transferencia: relación 1:N con la factura. El archivo vive en
-- Supabase Storage; acá solo se guarda su ruta y sus datos.
CREATE TABLE IF NOT EXISTS comprobantes_pago (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    nombre_archivo TEXT NOT NULL,
    ruta_storage TEXT NOT NULL UNIQUE,
    tipo_mime TEXT NOT NULL CHECK (tipo_mime IN ('image/png', 'image/jpeg', 'application/pdf')),
    tamano_bytes INTEGER NOT NULL CHECK (tamano_bytes > 0),
    subido_por INTEGER NOT NULL REFERENCES users(id),
    subido_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS factura_items_factura_idx ON factura_items (factura_id);
CREATE INDEX IF NOT EXISTS comprobantes_pago_factura_idx ON comprobantes_pago (factura_id);
CREATE INDEX IF NOT EXISTS inscripciones_servicio_alumno_idx ON inscripciones_servicio (alumno_id, anio, mes);

-- --- Seguridad: Row Level Security en todas las tablas ---
-- Supabase expone automáticamente una API REST pública sobre el esquema
-- `public`; sin RLS cualquiera con la clave pública podría leer/escribir las
-- tablas (incluida `users`). Con RLS activado y SIN políticas, esa API queda
-- bloqueada. El backend no se ve afectado: se conecta como el usuario
-- `postgres` (dueño de las tablas), que no está sujeto a RLS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE niveles ENABLE ROW LEVEL SECURITY;
ALTER TABLE aulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE alumnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE materias ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE calificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_alumnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE comedor_asistencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE transporte_rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE transporte_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE instalaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE instalaciones_reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE enfermeria_incidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividades_extra ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscripciones_extra ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividad_asistencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividad_calificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscripciones_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE factura_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes_pago ENABLE ROW LEVEL SECURITY;
