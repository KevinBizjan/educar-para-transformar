# Educar para Transformar - Plataforma Web Educativa

Sistema integral de gestión institucional para el centro educativo **"Educar para Transformar"**, desarrollado bajo una arquitectura moderna, modular y basada en principios de código limpio (*Clean Code*).

---

## 👥 Integrantes del Equipo
* **Portillo**
* **Bizjan**

---

## 📖 Descripción Breve
Plataforma web educativa completa orientada a la administración escolar, comunicación institucional y seguimiento pedagógico/financiero. Integra un backend modular con API RESTful sobre Node.js/Express y una Single Page Application (SPA) responsiva con React 19 y Vite, permitiendo una experiencia adaptada según el rol del usuario (Administrador, Docente, Alumno y Padre/Tutor).

---

## 🛠️ Cómo Ejecutar el Programa

El proyecto se estructura en dos componentes desacoplados: `backend` y `frontend`.

### Requisitos Previos
* Node.js (versión 18 o superior recomendada)
* npm

### 1. Puesta en marcha del Backend
```bash
# Acceder a la carpeta del backend
cd backend

# Instalar dependencias
npm install

# Inicializar la base de datos con usuarios y datos de prueba (solo la primera vez)
node seed.js

# Iniciar el servidor en modo desarrollo
npm run dev
```
> El servidor API REST se ejecutará por defecto en `http://localhost:3000`.

### 2. Puesta en marcha del Frontend
```bash
# Abrir una nueva terminal y acceder a la carpeta del frontend
cd frontend

# Instalar dependencias
npm install

# Iniciar el servidor de desarrollo de Vite
npm run dev
```
> La aplicación web interactiva estará disponible en `http://localhost:5173`.

---

## ✨ Funcionalidades Principales

1. **Gestión de Preinscripciones Online:** Formulario público con validaciones en tiempo real para aspirantes y panel administrativo de aprobación/rechazo.
2. **Control de Acceso y Autenticación Basada en Roles (RBAC):**
   * Sesiones seguras mediante JSON Web Tokens (JWT) y cifrado de contraseñas con Bcrypt.
   * Dashboards adaptados y protegidos según 4 roles:
     * 👑 **Administrador:** Gestión integral de usuarios, niveles educativos, cursos, materias, horarios, personal y finanzas.
     * 👨‍🏫 **Docente:** Registro de asistencia, carga y ponderación de calificaciones, seguimiento de incidencias y reserva de recursos.
     * 🎓 **Alumno:** Visualización de horario de clases, materias cursadas, historial de calificaciones y avisos escolares.
     * 👨‍👩‍👧 **Padre / Tutor:** Vinculación de alumnos, seguimiento de rendimiento académico, control de cuotas y descarga de comprobantes de pago en PDF.
3. **Módulo Financiero y Facturación:** Emisión de cuotas, registro de pagos y generación dinámica de comprobantes en PDF (PDFKit).
4. **Módulo Académico:** ABM de niveles, aulas, cursos, asignaturas, actividades extracurriculares y asignación de transporte escolar.
5. **Comunicación y Notificaciones:** Cartelera de anuncios y reportes estadísticos institucionales.

---

## 🔑 Credenciales de Prueba (Demo)

| Rol | Usuario | Contraseña | Acceso / Funcionalidad Principal |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin` | `admin123` | Gestión global del sistema y usuarios |
| **Docente** | `docente` | `docente123` | Carga de calificaciones y asistencia |
| **Alumno** | `alumno` | `alumno123` | Consulta de materias, notas y horarios |
| **Padre** | `padre` | `padre123` | Seguimiento de hijos, pagos y comprobantes |

---

## 📂 Estructura del Repositorio
* `backend/src/controllers/`: Controladores con la lógica de negocio y endpoints.
* `backend/src/utils/`: Utilidades centralizadas de validación y helpers (Clean Code / DRY).
* `backend/src/middlewares/`: Protección de rutas y verificación de JWT / roles.
* `backend/src/routes/`: Definición de endpoints organizados por dominio.
* `frontend/src/components/`: Componentes modulares y reutilizables de UI.
* `frontend/src/pages/`: Dashboards específicos para cada rol de usuario.
* `frontend/src/utils/`: Validadores y helpers de comunicación API para el cliente.
* `frontend/src/context/`: Estado global de autenticación (`AuthContext`).
* `mobile/`: App móvil para padres y tutores (React Native con Expo). Ver [mobile/README.md](mobile/README.md).
* `docs/PROTOCOLO_IA.md`: Protocolo de validación del código generado con IA y bitácora.

## 📊 Reportes de la Dirección

En el panel del administrador, pestaña **Reportes**, están los 9 listados que pide la Dirección: por alumno, por docente, alumnos por curso, por materia, por deporte (con nivel, horario y profesor) y por recorrido de transporte, y docentes por nivel educativo. Se pueden ver en pantalla o descargar en CSV (se abre en Excel).

* Los datos de deportes, transporte y comedor son los del **mes elegido** (por defecto, el actual), porque las inscripciones son mensuales.
* Las listas incluyen solo alumnos activos. Los profesores por materia salen de los **Horarios** cargados en Gestión Académica.
* API: `GET /api/reportes` (catálogo) y `GET /api/reportes/<reporte>`; con `?formato=csv` se descarga el archivo. Solo el administrador tiene acceso.

## 🔗 Cuentas vinculadas y vistas por rol

Una cuenta con rol **docente** o **alumno** se asocia a su legajo para que cada persona vea solo lo suyo. El administrador lo hace en la pestaña **Usuarios y Roles → Vincular cuentas con legajos**: una cuenta por persona y una persona por cuenta.

* **Docente:** con la cuenta vinculada ve la tarjeta **Mis cursos y horarios** (cursos por nivel y horario de cada materia) y solo a los alumnos y materias de sus cursos. Mientras la cuenta no esté vinculada mantiene la vista completa, para no dejar sin pantalla a quien todavía no fue asociado.
* **Padre:** en **Ficha de mi hijo/a** ve las materias con su profesor, los deportes con horario y profesor, el transporte y el comedor del mes elegido. Si el hijo todavía no tiene curso, puede **inscribirlo al cursado** en un curso con vacantes; cambiar un curso ya asignado lo decide la Dirección.
* **Alumno:** con la cuenta vinculada ve sus materias con el profesor de cada una, su transporte y su comedor, y en **Mis deportes** elige entre los grupos de su nivel (con horario, profesor y valor mensual) y se inscribe o se da de baja, con las mismas reglas que la familia: máximo 2 deportes por mes, sin horarios superpuestos y con cupo. Solo gestiona sus **propios deportes**: el transporte y el comedor los decide la familia. Sin vínculo, ve un aviso en lugar de datos.
* **Deportes y actividades:** los deportes se inscriben por grupo (nivel, horario y profesor) para todos los perfiles, y la asistencia y las notas que carga el docente salen de esos grupos. **Cultura e Idioma** (por ejemplo Teatro e Inglés) siguen con el sistema anterior de actividades.
* API: `GET /api/vinculos` y `PUT /api/vinculos/{alumnos|docentes}/:id` (administrador); `GET /api/academico/mis-cursos` (docente); `GET /api/academico/mis-hijos/:id/ficha`, `GET /api/academico/cursos-disponibles` y `POST /api/academico/mis-hijos/:id/inscribir-curso` (padre); `GET /api/academico/mi-ficha` (alumno), que usa además `/api/inscripciones/catalogo` y `/api/inscripciones` para sus deportes.
* Los profesores por materia salen de los **Horarios** cargados en Gestión Académica, igual que en los reportes.

## 🏅 Deportes, servicios e inscripciones

Todo se administra desde la web, sin tocar la base de datos:

* **Administrador → Servicios → Deportes y servicios:** crea los **grupos de deporte** (deporte, nivel, día y horario, **profesor responsable**, valor mensual y cupo), los servicios de transporte (uno por recorrido) y el comedor. Se pueden editar el valor, el cupo y el profesor, y desactivar un servicio (deja de ofrecerse a las familias). Los deportes en sí se crean en Gestión Académica → Actividades; para cambiar el nivel o el horario de un grupo se crea uno nuevo y se desactiva el anterior.
* **Administrador → Servicios → Inscripciones a servicios:** inscribe a cualquier alumno en deportes, transporte o comedor, o lo da de baja, mes por mes.
* **Padre → Servicios de mis hijos:** lo mismo para cada hijo. **Alumno → Mis deportes:** solo sus propios deportes.
* **Reglas (las valida el servidor):** máximo 2 deportes por mes, sin horarios superpuestos, del nivel del alumno, un solo recorrido de transporte por mes, con cupo y sin inscripciones duplicadas. Una inscripción ya facturada no se puede dar de baja.
* **Gestión Académica:** los cursos se pueden editar (división y cupo, que no puede quedar por debajo de los alumnos del curso) y no se eliminan si tienen alumnos o materias. En **Personal y Docentes**, el botón **A cargo** muestra las materias y los cursos de cada docente por nivel, con sus horarios; se asignan cargando un horario en Gestión Académica → Horarios.
* **Primer arranque:** el catálogo se puede armar desde estas pantallas, o cargar de una vez con los datos de ejemplo (`SEED_ON_BOOT=true`, ver [DEPLOY.md](DEPLOY.md)).

## 🧱 Reglas de integridad

Lo que garantiza la base de datos y no solo la pantalla (así dos pedidos simultáneos no pueden romperlo):

* **Legajo:** `A-00012` para los alumnos, `D-00005` para los docentes y `P-00007` para el resto del personal. Es el mismo en las tablas del administrador, la búsqueda, las exportaciones, las fichas y los reportes.
* **Transporte (asignación del administrador):** el alumno debe estar activo y tiene **una sola ruta asignada** (para cambiarla se quita y se asigna la nueva). Cada recorrido tiene capacidad: los lugares ocupados cuentan a los asignados y a los inscriptos del mes. No se elimina un recorrido con alumnos asignados ni con servicio en el catálogo, y el servicio tiene como máximo 4 recorridos.
* **Sin duplicados:** una inscripción por alumno y actividad (Cultura e Idioma), un registro de comedor por alumno y día (registrarlo de nuevo lo corrige), una nota por alumno, materia y trimestre (y por alumno y deporte), y sin cursos, materias ni recorridos repetidos dentro de su nivel, curso o escuela.
* **Al actualizar:** el esquema se aplica solo al arrancar. Si hubiera duplicados exactos de antes, se conserva el registro que corresponde (el más reciente, salvo en las inscripciones a actividades, donde se conserva el original). Los cursos, materias o recorridos que ya estén repetidos no se tocan: se avisa y el índice no se crea.

## 🔁 Integración continua y flujo de trabajo

**Flujo:** issue → rama → Pull Request (con `Closes #n`) → GitHub Actions → merge a `main` → Render despliega a producción.

1. Cada tarea es un *issue* (plantillas en `.github/ISSUE_TEMPLATE`) y se sigue en el tablero Kanban del repositorio (Projects).
2. Se trabaja en una rama `feat/...` o `fix/...` y se abre un Pull Request. La plantilla pide el issue relacionado.
3. **GitHub Actions** (`.github/workflows/ci.yml`) corre en cada PR y en cada push a `main`:
   * *Frontend:* `npm ci` → ESLint → build de Vite → guarda `frontend/dist` como artefacto (7 días).
   * *Backend:* levanta un PostgreSQL descartable, aplica el esquema, siembra (`node seed.js`) y corre `npm test`.
4. Si la CI está en rojo, el PR no debería mergearse. Al mergear, Render redeploya solo (ver [DEPLOY.md](DEPLOY.md)).

La CI no usa secretos: la base y la clave JWT se generan al azar en cada ejecución y nunca se toca Supabase.

## 🧪 Pruebas automáticas

El backend tiene 41 pruebas (`node:test`): validadores, patrones de diseño y la API completa
(autenticación y JWT, RBAC, cupos, notas 1-10, asistencia, finanzas con PDF, servicios,
comunicados, Mi Perfil y horarios sin superposición).

Las pruebas de API corren **solo contra un PostgreSQL local** (si `DATABASE_URL` no apunta a
`localhost` se saltean solas), para no escribir datos de prueba en Supabase.

```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
cd backend
export DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres DATABASE_SSL=false JWT_SECRET=test
node seed.js && npm test
```

## 🚀 Despliegue

Un solo servicio: Express sirve la API y el frontend compilado. Pasos, variables de entorno
y verificación en [DEPLOY.md](DEPLOY.md).

---
© 2026 Educar para Transformar - Portillo & Bizjan.
