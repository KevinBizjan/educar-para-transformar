# Desplegar en Railway (un solo servicio)

Esta app se despliega como **un único servicio**: el backend Express sirve la API
(`/api/...`) y además entrega el frontend de React compilado (`frontend/dist`).
Una sola URL, sin CORS.

Railway detecta el `package.json` y el `railway.json` de la **raíz** del repo y
ejecuta:
- **Build**: `npm run build` → compila el frontend y prepara el backend.
- **Start**: `npm start` → arranca el backend (que también sirve el frontend).
- **Health check**: `GET /api/health` (si no responde, Railway reinicia el servicio,
  hasta 10 veces).

La base de datos vive aparte, en **Supabase** (PostgreSQL).

## 1. Configurar el servicio en Railway
1. Entra a tu proyecto en Railway → tu servicio.
2. **Settings → Root Directory** = **vacío** (la raíz del repo, NO `backend`).
   ⚠️ Si antes lo tenías en `backend`, bórralo para que use la raíz.
3. **Settings → Networking → Generate Domain** → esa es la URL pública de tu app.

## 2. Variables de entorno
En **Variables** del servicio agrega:

| Variable | Valor | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Cadena del **Transaction pooler** de Supabase (ver abajo) | Sí |
| `JWT_SECRET` | Texto largo y aleatorio (al menos 32 caracteres) | Sí |
| `SEED_ON_BOOT` | `true` solo para cargar los datos demo; después `false` | No |
| `DATABASE_SSL` | No definir (SSL activo por defecto, Supabase lo exige) | No |
| `PORT` | **No definir**: Railway lo inyecta solo | No |

**`DATABASE_URL` (Supabase):**
1. En Supabase pulsa **Connect** → **Transaction pooler** (puerto **6543**).
2. Copia la cadena. Tiene esta forma:
   `postgresql://postgres.<proyecto>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
3. Reemplaza `[YOUR-PASSWORD]` por la contraseña real **sin los corchetes**.

⚠️ No uses la conexión directa (`db.<proyecto>.supabase.co`): es solo IPv6 y falla
desde Railway con `ENOTFOUND`.

**`JWT_SECRET`:** si no se define, el servidor arranca pero usa una clave de
desarrollo que es pública (está en el código) y avisa en el log con
`ADVERTENCIA: JWT_SECRET no está definida`. Cualquiera podría fabricar tokens y
entrar como administrador. Para generar una:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Persistencia de datos
La base vive en Supabase, no en el disco del servicio, así que **no hace falta
ningún Volume**: los datos sobreviven a cada deploy/reinicio mientras
`DATABASE_URL` apunte al mismo proyecto.

El esquema (`backend/src/config/schema.sql`) se aplica solo al arrancar el
servidor (usa `CREATE TABLE IF NOT EXISTS`, así que es seguro en cada deploy).
También se puede aplicar a mano con `node backend/migrate.js`.

`SEED_ON_BOOT=true` carga los usuarios y datos demo; como usa
`ON CONFLICT ... DO NOTHING` y chequeos previos, no pisa ni duplica lo que ya haya.

## 4. Seguridad antes de mostrar o entregar
- Los usuarios demo tienen **contraseñas conocidas** (ver más abajo). Después del
  primer arranque pon `SEED_ON_BOOT=false`. Si la app va a quedar publicada, cambia
  las contraseñas de `admin`, `docente`, `alumno` y `padre`.
- El archivo `.env` está en `.gitignore`: nunca subas la contraseña de Supabase ni
  `JWT_SECRET` al repositorio. Si alguna vez quedaron publicadas, rótalas
  (Supabase → Database → Reset password).
- La base tiene **RLS activado** en todas las tablas y el backend se conecta con el
  usuario de base de datos: la API de datos pública de Supabase queda cerrada.
- El token de sesión vence a los **30 minutos**.

## 5. Plan gratuito de Supabase
Un proyecto del plan gratuito se **pausa tras 7 días sin actividad**. Si la app
empieza a fallar con errores de conexión o `tenant/user not found`, entra a
Supabase y pulsa **Restore project**. Conviene entrar una vez antes de una
presentación para comprobar que esté activo.

## 6. Redeploy
Tras subir cambios a GitHub, Railway redeploya solo. Si no, usa **Deploy** manual.

## 7. Verificación después de cada deploy
Reemplaza `TU-DOMINIO` por la URL pública generada:

```bash
curl https://TU-DOMINIO/api/health
```

Debe responder `{"message":"API Educar para Transformar - Activa"}`. Después:

1. Abrir `https://TU-DOMINIO/` → debe cargar la página institucional.
2. Abrir directamente una ruta interna (por ejemplo `https://TU-DOMINIO/login`) →
   no debe dar 404 (el servidor devuelve la app y React resuelve la ruta).
3. Iniciar sesión con `admin` y verificar que el panel muestra datos.
4. Registrar un pago de prueba y descargar el comprobante en PDF.
5. En los logs de Railway no debe aparecer `ADVERTENCIA: JWT_SECRET`.

Con un deploy sano, los logs muestran: `Servidor corriendo en el puerto <N>`
(puerto interno; para entrar usa siempre la URL pública, no `localhost`) y
`Conectado a PostgreSQL ... y esquema verificado.`

## 8. Si algo falla
| Síntoma en los logs | Causa probable | Solución |
|---|---|---|
| `ENOTFOUND db.<proyecto>.supabase.co` | Se usó la conexión directa | Usar el Transaction pooler (sección 2) |
| `password authentication failed` | Contraseña mal copiada o con corchetes | Copiarla sin corchetes; resetearla si hace falta |
| `Tenant or user not found` | Proyecto pausado o usuario sin `.<proyecto>` | Restaurar el proyecto; usar la cadena completa del pooler |
| El health check falla y reinicia en bucle | La base no responde | Revisar `DATABASE_URL` y que el proyecto esté activo |
| La web abre en blanco pero `/api/health` funciona | El build del frontend no se generó | Revisar el log de **Build** y que `Root Directory` esté vacío |

## Usuarios de prueba (creados por el seed)
- admin / admin123
- docente / docente123
- alumno / alumno123
- padre / padre123

## Desarrollo local
- Backend: `cd backend && npm run dev` (puerto 3000).
- Frontend: `cd frontend && npm run dev` (Vite, apunta a `http://localhost:3000`).
- Pruebas automáticas: ver la sección "Pruebas automáticas" del README (corren
  contra un PostgreSQL local, nunca contra Supabase).
