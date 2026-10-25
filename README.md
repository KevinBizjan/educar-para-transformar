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
