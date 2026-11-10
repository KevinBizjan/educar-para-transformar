# Desplegar la plataforma (un solo servicio)

Esta app se despliega como **un único servicio**: el backend Express sirve la API
(`/api/...`) y además entrega el frontend de React compilado (`frontend/dist`).
Una sola URL, sin CORS.

- **Build**: `npm run build` → compila el frontend y prepara el backend.
- **Start**: `npm start` → arranca el backend (que también sirve el frontend).
- **Health check**: `GET /api/health`.

La base de datos vive aparte, en **Supabase** (PostgreSQL). El servicio no guarda
nada en disco, así que **no hace falta ningún Volume** ni disco persistente.

## Dónde publicarla

| Plataforma | Costo | Notas |
|---|---|---|
| **Render** (recomendada) | Plan gratuito | La app se duerme tras 15 min sin tráfico y la primera visita tarda cerca de 1 min en despertarla. 750 horas de instancia por mes |
| Railway | De pago (plan Hobby) | No tiene plan gratuito permanente: el crédito de prueba es de una sola vez |
| Localhost | Gratis | `npm run dev` en backend y frontend; ver el final de esta guía |

Los precios y límites cambian: confirmalos en las páginas oficiales de cada plataforma.

---

## A. Render (plan gratuito)

### Opción 1: con el Blueprint (`render.yaml`, recomendada)
1. En Render: **New → Blueprint** y elige este repositorio de GitHub.
2. Render lee `render.yaml` y te pide dos valores:
   - `DATABASE_URL`: la cadena del **Transaction pooler** de Supabase (ver sección 2).
   - `SEED_ON_BOOT`: `true` para cargar los datos demo la primera vez.
3. **Apply**. `JWT_SECRET` lo genera Render solo.
4. Cuando termine el primer deploy, abre la URL `https://<nombre>.onrender.com`.
5. Cambia `SEED_ON_BOOT` a `false` en **Environment** (ver sección 4).
6. (Opcional) En **Environment** agrega `PAGO_TITULAR`, `PAGO_BANCO`, `PAGO_CBU` y `PAGO_ALIAS`: son los datos para transferir que la app muestra al padre cuando genera una factura. Si no están, la app le indica que los consulte en la institución.
7. (Comprobantes de pago) Crea en Supabase → Storage un bucket **privado** llamado `comprobantes` y agrega en **Environment** `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` (la clave **secreta** del proyecto, en Project Settings → API Keys). Sin ellas, adjuntar un comprobante responde que el almacenamiento no está configurado. El mismo par va en `backend/.env` para probarlo en tu equipo con `npm run verificar:storage` (dentro de `backend`).
8. (Correos automáticos) En **Environment** agrega `RESEND_API_KEY` (clave de resend.com) y `CRON_SECRET` (un texto largo al azar), y opcionalmente `MAIL_FROM`, `MAIL_REDIRIGIR_A` y `FERIADOS` (ver `backend/.env.example`). Con el remitente de prueba de Resend solo se puede escribir al correo de tu propia cuenta: para escribirle a las familias hay que **verificar un dominio** en resend.com y usar su remitente en `MAIL_FROM`. Mientras tanto, `MAIL_REDIRIGIR_A` manda todo a una sola casilla. Cada familia recibe los correos en la dirección que usó para registrarse (su nombre de usuario); las cuentas cuyo usuario no es un correo quedan registradas como «Omitido».
9. (Programador diario) En GitHub → Settings → Secrets and variables → Actions crea `APP_URL` (la dirección del servicio en Render) y `CRON_SECRET` (el mismo valor que en Render). El workflow `.github/workflows/correos.yml` llama al servidor de lunes a viernes a las 10:00 (hora de Argentina). El servidor decide qué corresponde según la fecha: la **factura de fin de mes** desde el último día hábil y el **aviso de deuda** el día 20 (con dos días de gracia), sin repetir lo ya enviado. La auditoría de cada correo está en la pestaña «Correos» del panel del administrador, donde también se puede simular o disparar el envío a mano.

### Opción 2: a mano, sin Blueprint
1. **New → Web Service** → elige el repositorio.
2. **Runtime**: Node. **Root Directory**: vacío (la raíz, no `backend`).
3. **Build Command**: `npm run build`. **Start Command**: `npm start`.
4. **Instance Type**: Free. **Health Check Path**: `/api/health`.
5. En **Environment** carga las variables de la sección 2, más `NODE_VERSION` = `22.22.0`.
6. **Create Web Service**.

### Cosas propias de Render
- **Cada push a `main` redespliega solo** (auto-deploy activado por defecto).
- **Se duerme por inactividad.** Antes de una presentación abre la URL 2 o 3 minutos
  antes, para que ya esté despierta. Mientras despierta, el navegador muestra una
  página de carga.
- **No definas `PORT`**: Render lo inyecta y el servidor ya lo lee.
- Render puede reiniciar un servicio gratuito en cualquier momento; no hay
  problema porque no se guarda nada en el servicio.
- La región es Virginia (la más cercana a Sudamérica); Supabase está en São Paulo,
  así que cada consulta suma algo de latencia. Es normal.

---

## B. Railway (de pago)

Railway detecta el `package.json` y el `railway.json` de la **raíz** y ejecuta lo mismo
(build, start y health check `/api/health`; reinicia hasta 10 veces si falla).

1. Entra a tu proyecto en Railway → tu servicio.
2. **Settings → Root Directory** = **vacío** (la raíz del repo, NO `backend`).
3. **Settings → Networking → Generate Domain** → esa es la URL pública.
4. Carga las variables de la sección 2. No definas `PORT`.

---

## 2. Variables de entorno

| Variable | Valor | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Cadena del **Transaction pooler** de Supabase (ver abajo) | Sí |
| `JWT_SECRET` | Texto largo y aleatorio (al menos 32 caracteres) | Sí |
| `SEED_ON_BOOT` | `true` solo para cargar los datos demo; después `false` | No |
| `NODE_VERSION` | `22.22.0` (solo Render; ya viene en el Blueprint) | No |
| `DATABASE_SSL` | No definir (SSL activo por defecto, Supabase lo exige) | No |
| `PORT` | **No definir**: la plataforma lo inyecta sola | No |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Dirección del proyecto y clave **secreta** de Supabase: sin ellas no se pueden adjuntar comprobantes (HU8) | Para comprobantes |
| `SUPABASE_BUCKET` | Bucket privado de los comprobantes (por defecto `comprobantes`) | No |
| `RESEND_API_KEY` | Clave de resend.com para los correos automáticos (HU10) y los códigos de recuperación de contraseña de la app | Para correos |
| `MAIL_FROM` | Remitente; con el de prueba solo se entrega a la cuenta dueña de Resend | No |
| `MAIL_REDIRIGIR_A` | Modo prueba o demostración: todos los correos van a esta casilla | No |
| `CRON_SECRET` | Texto largo al azar; el mismo valor va como secreto `CRON_SECRET` en GitHub | Para correos |
| `PAGO_TITULAR`, `PAGO_BANCO`, `PAGO_CBU`, `PAGO_ALIAS` | Datos para transferir que la app le muestra al padre | No |
| `FERIADOS` | Feriados `AAAA-MM-DD` separados por coma, para el último día hábil | No |
| `SCHEMA_FORZAR` | `true` reaplica el esquema aunque no haya cambiado (ver sección 3) | No |

**`DATABASE_URL` (Supabase):**
1. En Supabase pulsa **Connect** → **Transaction pooler** (puerto **6543**).
2. Copia la cadena. Tiene esta forma:
   `postgresql://postgres.<proyecto>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
3. Reemplaza `[YOUR-PASSWORD]` por la contraseña real **sin los corchetes**.

⚠️ No uses la conexión directa (`db.<proyecto>.supabase.co`): es solo IPv6 y falla
desde Render y Railway con `ENOTFOUND`.

**`JWT_SECRET`:** si no se define, el servidor arranca pero usa una clave de
desarrollo que es pública (está en el código) y avisa en el log con
`ADVERTENCIA: JWT_SECRET no está definida`. Cualquiera podría fabricar tokens y
entrar como administrador. Para generar una:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Persistencia de datos
Los datos sobreviven a cada deploy y reinicio mientras `DATABASE_URL` apunte al
mismo proyecto de Supabase.

El esquema (`backend/src/config/schema.sql`) se aplica solo al arrancar el
servidor y **únicamente si el archivo cambió** desde el último arranque (su huella se
guarda en la tabla `schema_version` y se aplica con un bloqueo, de a un proceso por vez).
Solo agrega tablas, columnas e índices (`IF NOT EXISTS`), así que es seguro en cada deploy.
`SCHEMA_FORZAR=true` lo reaplica igual. También se puede aplicar a mano con `node backend/migrate.js`.

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

## 6. Verificación después de cada deploy
Reemplaza `TU-DOMINIO` por la URL pública del servicio:

```bash
curl https://TU-DOMINIO/api/health
```

Debe responder `{"message":"API Educar para Transformar - Activa"}`. Después:

1. Abrir `https://TU-DOMINIO/` → debe cargar la página institucional.
2. Abrir directamente una ruta interna (por ejemplo `https://TU-DOMINIO/login`) →
   no debe dar 404 (el servidor devuelve la app y React resuelve la ruta).
3. Iniciar sesión con `admin` y verificar que el panel muestra datos.
4. Registrar un pago de prueba y descargar el comprobante en PDF.
5. En los logs no debe aparecer `ADVERTENCIA: JWT_SECRET`.

Con un deploy sano, los logs muestran: `Servidor corriendo en el puerto <N>`
(puerto interno; para entrar usa siempre la URL pública, no `localhost`) y
`Conectado a PostgreSQL ... y esquema verificado.`

## 7. Si algo falla
| Síntoma | Causa probable | Solución |
|---|---|---|
| `ENOTFOUND db.<proyecto>.supabase.co` | Se usó la conexión directa | Usar el Transaction pooler (sección 2) |
| `password authentication failed` | Contraseña mal copiada o con corchetes | Copiarla sin corchetes; resetearla si hace falta |
| `Tenant or user not found` | Proyecto pausado o usuario sin `.<proyecto>` | Restaurar el proyecto; usar la cadena completa del pooler |
| El build falla con `vite: not found` | Se instalaron solo dependencias de producción | Dejar `NODE_ENV` sin definir durante el build |
| El health check falla y reinicia en bucle | La base no responde | Revisar `DATABASE_URL` y que el proyecto esté activo |
| La web abre en blanco pero `/api/health` funciona | El build del frontend no se generó | Revisar el log de **Build** y que la raíz del servicio esté vacía |
| La primera visita tarda mucho (Render) | El servicio estaba dormido | Es normal: espera cerca de 1 minuto y recarga |

## 8. Code freeze y despliegue final (HU13)
Orden para publicar la versión final. Los responsables son Kevin y Valentina; cada paso lo marca quien lo hace.

**Antes del freeze**
- [ ] Todas las historias de usuario están mergeadas y `main` tiene la CI en verde (lint, build, pruebas del backend y pruebas E2E de Cypress).
- [ ] `docs/PROTOCOLO_IA.md` tiene la bitácora al día, incluida la auditoría de la HU13.

**Freeze**
- [ ] Desde este momento `main` solo recibe correcciones de errores del despliegue (PR chico, revisado por la otra persona). Nada de funciones nuevas.
- [ ] (Opcional, lo decide el equipo) Proteger `main` en GitHub → Settings → Branches: exigir PR y CI en verde.

**Configuración en Render** (Environment; sección 2)
- [ ] `DATABASE_URL` del Transaction pooler y `JWT_SECRET` largo; `SEED_ON_BOOT=false` (y cambiadas las contraseñas de los usuarios demo, sección 4).
- [ ] `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`, con el bucket privado `comprobantes` creado.
- [ ] `RESEND_API_KEY` y `CRON_SECRET`; `MAIL_REDIRIGIR_A` mientras se prueba. Para escribirle a las familias hay que verificar un dominio en Resend y definir `MAIL_FROM`; después se borra `MAIL_REDIRIGIR_A`.
- [ ] En GitHub → Secrets: `APP_URL` y `CRON_SECRET` (el mismo valor que en Render).
- [ ] El proyecto de Supabase está activo (sección 5).

**Publicar y verificar**
- [ ] En Render: **Manual Deploy → Deploy latest commit** de `main`.
- [ ] Verificación de la sección 6 (`/api/health`, página inicial, ruta interna, login de administrador).
- [ ] Desde `backend/`, con el `.env` apuntando a la misma base: `npm run verificar:storage` y `npm run verificar:correo -- tu@correo.com`.
- [ ] GitHub → Actions → **Correos automáticos** → *Run workflow*: debe responder HTTP 200.

**Recorrido de aceptación** (el mismo que cubre la prueba `backend/tests/flujo-completo.test.js`, pero contra el servicio publicado)
1. El administrador da de alta una familia con un hijo y le crea la cuota del mes.
2. En la app móvil, el padre inicia sesión, ve a su hijo y se inscribe a un servicio.
3. Genera la factura de la cuota y el servicio, y adjunta un comprobante: la factura queda **En revisión**.
4. En el panel web → 🧾 Facturas, el administrador abre el comprobante y la da por pagada.
5. En la app, el padre ve la cuota como pagada y la factura en su historial, y descarga el PDF.
6. En el panel web → Reportes, «Pagos por alumno» muestra al alumno como **Completo** y «Ingresos por mes» suma ese pago.

**Si algo sale mal**: en Render, **Rollback** al deploy anterior. Es seguro porque el esquema solo agrega; las tablas y columnas nuevas quedan sin usar. Los datos viven en Supabase y no se tocan.

**Después**
- [ ] Anotar la fecha y el commit publicados. Con el visto bueno del equipo, crear la etiqueta de versión (`git tag v1.0.0` y `git push origin v1.0.0`).

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
