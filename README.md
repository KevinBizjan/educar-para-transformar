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

## 🔁 Integración continua y gestión del trabajo

**Flujo de trabajo:** issue → rama → Pull Request → CI → merge → Vercel.

1. Cada tarea es un *issue* (plantillas en `.github/ISSUE_TEMPLATE`) con etiquetas y un hito (Hito 1 a 4).
2. Se trabaja en una rama `feat/...` o `fix/...` y se abre un Pull Request (`Closes #n` en la descripción).
3. **GitHub Actions** (`.github/workflows/ci.yml`) corre en cada PR y en cada push a `main`:
   * *Frontend:* `npm ci` → ESLint → build de Vite → guarda `frontend/dist` como artefacto.
   * *Backend:* levanta un PostgreSQL 17 descartable, aplica el esquema y siembra (`node seed.js`) y ejecuta `npm test` (reglas de negocio, RBAC, JWT, asistencia, finanzas).
4. Al mergear, Vercel publica a producción y el issue se cierra solo.

Las pruebas de API solo corren contra una base local (`localhost`); nunca contra Supabase. Para correrlas en tu máquina:

```bash
docker run -d --name pg-test -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
cd backend
export DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres DATABASE_SSL=false JWT_SECRET=test
node seed.js && npm test
```

---
© 2026 Educar para Transformar - Portillo & Bizjan.
