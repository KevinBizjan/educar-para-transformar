# App móvil · Educar para Transformar

Aplicación para padres y tutores, hecha con **React Native y Expo**. Consume la **misma API REST** que la web (carpeta `backend/`); Supabase se usa **solo para Storage** (comprobantes de pago).

## Cómo correrla

Requisitos: Node 22.13 o superior (o 24.3+) y la app **Expo Go** instalada en el celular (Android o iPhone).

```bash
cd mobile
npm install
npx expo start
```

Escaneá el código QR con Expo Go. La computadora y el celular tienen que estar en la misma red Wi-Fi.

Por defecto la app usa el servicio publicado en Render; la primera vez puede tardar hasta 1 minuto, porque el plan gratuito lo duerme tras 15 minutos sin tráfico. Para entrar usá una cuenta de familia (rol padre/tutor): la misma que usa en el portal web.

### Usar un backend local

El celular no entiende `localhost`. Copiá `.env.example` a `.env` y poné la IP de tu computadora:

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:3000
```

En el emulador de Android la computadora es `http://10.0.2.2:3000`. Después de cambiar `.env`, reiniciá con `npx expo start -c`.

## Instalar en un celular Android (APK)

Para probar la app sin Expo Go ni computadora se genera un instalador `.apk` con EAS Build (el perfil `preview` de `eas.json`). Hace falta una cuenta gratuita de [expo.dev](https://expo.dev).

```bash
cd mobile
npx eas-cli login                         # una sola vez, con la cuenta de Expo
npx eas-cli init                          # una sola vez: vincula la app con el proyecto de Expo
npx eas-cli build -p android --profile preview
```

Al terminar (la primera vez puede tardar unos minutos en la cola gratuita), EAS muestra un **enlace y un código QR de descarga**. Se abre desde el celular, se descarga el `.apk` y se instala (Android pide permitir la instalación desde el navegador). La app usa el backend publicado en Render, así que no necesita nada más.

- Antes de una demostración, abrir una vez la URL del servicio en Render: el plan gratuito lo duerme y la primera respuesta tarda hasta 1 minuto.
- Para iPhone no hay instalador sin una cuenta de Apple de pago: se usa Expo Go (ver arriba).

## Comprobar sin celular

```bash
npm test                   # 74 pruebas: cliente de la API, sesión, validaciones, "Mis hijos", "Cuotas", "Pagar", comprobantes e historial (sin red)
npm run verificar:conexion # llama al backend real: GET /api/health
```

## Estructura

| Ruta | Qué hay |
|---|---|
| `App.js` | Raíz de la app: redirige según la sesión y el rol |
| `src/auth/` | Sesión: login, renovación y cierre (`sesion.js`), contexto de React y almacenamiento seguro del token |
| `src/familia/` | Lógica de "Mis hijos": carga del resumen, caché en memoria, formato de montos y meses |
| `src/cuentas/` | Lógica de "Cuotas" (carga por filtro, caché y textos), de "Pagar" (selección, total exacto y factura) y de los comprobantes (validación y subida) y del historial (rangos de fechas y PDF) |
| `src/screens/` | Pantallas: inicio de sesión, "Mis hijos", "Cuotas", "Pagar", "Mi cuenta", cambio de contraseña y acceso no disponible |
| `src/utils/validators.js` | Reglas de contraseña (las mismas del backend y la web) |
| `src/config.js` | URL de la API y claves públicas de Supabase (variables `EXPO_PUBLIC_*`) |
| `src/api/client.js` | Cliente de la API: token JWT, errores en español, tiempo de espera |
| `src/lib/supabase.js` | Cliente de Supabase, solo Storage |

## Sesión y roles (HU3)

- **Mismas credenciales que la web:** el login usa `POST /api/auth/login` y la misma tabla de usuarios; la app no guarda cuentas propias.
- **Token seguro:** se guarda con SecureStore (Keychain en iOS, Keystore en Android), no en texto plano.
- **Renovación:** mientras la app está abierta, el token se renueva cada 10 minutos y al volver a primer plano (`POST /api/auth/refresh`). Con más de 30 minutos sin abrirla, el servidor lo rechaza y hay que iniciar sesión de nuevo. Una sesión no puede superar las 12 horas.
- **Por rol:** los padres/tutores entran al inicio; administrador, docente y alumno ven un aviso para usar el portal web.
- **Cambio de contraseña:** pide la actual y aplica las mismas reglas que el registro web.
- **Pendiente:** la recuperación de contraseña por correo necesita el motor de correo (HU10).

## Mis hijos (HU5)

- Muestra **solo los hijos de la cuenta** que inició sesión, con su curso, el estado de cuenta (saldo pendiente o "Cuenta al día"), los **servicios inscriptos del mes** y el **consumo real del comedor** (los días que la escuela ya registró en la asistencia).
- Se puede navegar entre meses con las flechas; cada mes muestra sus propios servicios.
- **Una sola llamada** a la API (`GET /api/inscripciones/resumen-familia`) trae todo, sin importar cuántos hijos haya. Lo último que se vio queda en un caché en memoria: la pantalla lo muestra al instante y lo actualiza en segundo plano. Se puede actualizar a mano deslizando hacia abajo.
- Al cerrar sesión (o si la sesión vence) el caché se borra: no quedan datos de la familia en memoria.

## Cuotas (HU6)

- Pestaña **Cuotas** con tres filtros: **Pendientes**, **Pagadas** e **Historial** de pagos. Las cuotas se agrupan por hijo, con su importe, vencimiento y estado (Pendiente, Vencida, En revisión o Pagada); si el pago es parcial se ve cuánto se abonó y cuánto resta.
- Sin deuda aparece el mensaje «¡Estás al día!» y el total pendiente muestra «Cuenta al día».
- Una sola llamada a la API (`GET /api/cuentas/cuotas?estado=pendientes|pagadas|historial`, solo para el padre y solo de sus hijos). Los importes se calculan en centavos enteros y las fechas se toman en hora de Argentina.
- Solo se listan las cuotas ya emitidas (hasta el mes actual) del nivel de cada hijo. Un pago sin cuota asociada figura en el historial, pero no descuenta de ninguna cuota.

## Pagar (HU7)

- Pestaña **Pagar**: el padre elige cuotas y servicios (deporte, transporte, comedor) de sus hijos, ve el **total exacto** y genera una **factura consolidada** con su referencia (`EPT-AAAAMMDD-XXXXXX`) para pagar **por transferencia bancaria**. No hay pagos en efectivo.
- Los montos los calcula siempre el servidor: la app solo le dice qué ítems se eligieron. De una cuota con pago parcial se cobra lo que resta.
- Lo ya abonado no se ofrece, y lo que ya está en una factura abierta (pendiente o en revisión) se muestra bloqueado con su referencia: no se puede facturar dos veces, ni siquiera con dos pedidos simultáneos. Si una factura se rechaza, sus ítems vuelven a estar disponibles.
- API: `GET /api/cuentas/pagables`, `POST /api/cuentas/facturas`, `GET /api/cuentas/facturas` y `GET /api/cuentas/facturas/:id` (solo el padre y solo lo suyo).
- Los datos para transferir salen de las variables `PAGO_TITULAR`, `PAGO_BANCO`, `PAGO_CBU` y `PAGO_ALIAS` del servidor (ver `DEPLOY.md`); sin ellas, la app indica que se consulten en la institución.
## Comprobantes de pago (HU8)

- En «Mis facturas», cada factura abierta (pendiente o en revisión) permite **adjuntar uno o más comprobantes** (hasta 10, de hasta 5 MB cada uno) elegidos del teléfono: **PNG, JPG o PDF**. Al subir el primero, la factura pasa a **En revisión**. Se pueden ver (enlace temporal) y quitar mientras la factura siga abierta; sin comprobantes vuelve a «Pendiente de pago».
- La app avisa enseguida si el tipo o el tamaño no sirven, pero **el servidor revisa el contenido de verdad**: rechaza un archivo cuyo formato no coincide con el que declara y los archivos dañados o cortados (a un PNG le falta el final, a un PDF su `%%EOF`).
- **La app no habla con Storage**: manda el archivo al backend (`POST /api/cuentas/facturas/:id/comprobantes`), que lo guarda en un bucket **privado** de Supabase con la clave secreta del servidor. Así esa clave nunca está en el teléfono y cada archivo queda asociado a una factura. Si falla el guardado en la base, el archivo se retira de Storage.
- Configuración del servidor: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y, si hace falta, `SUPABASE_BUCKET` (ver `DEPLOY.md`). `npm run verificar:storage` (en `backend`) comprueba el bucket de verdad: sube, descarga con enlace firmado y borra una imagen de prueba.
- El cliente `src/lib/supabase.js` y las variables `EXPO_PUBLIC_SUPABASE_*` de la HU2 ya no se usan para esto.
- La revisión del comprobante la hace la Dirección desde la web (ver «Historial y revisión», HU9).

## Historial y revisión de facturas (HU9)

- **Historial** (Cuotas → «Historial»): las facturas de un período con su **desglose por ítem**, el estado de cada una y un **resumen** de lo facturado, pagado y pendiente. El período se elige con cuatro opciones rápidas: este mes, 3 meses, este año o todo. Si la Dirección rechazó una factura, se ve el motivo. Los pagos que la institución registró por su cuenta aparecen aparte, sin contarse dos veces con las facturas.
- **PDF**: «Ver historial en PDF» (todo el período) y «Comprobante en PDF» (cada factura). El visor del teléfono no puede mandar el token de sesión, así que el servidor da un **enlace temporal firmado** (5 minutos): `GET /api/cuentas/pdf-enlace` y `GET /api/cuentas/pdf/:token`. Ese token usa otro secreto: solo abre ese PDF y no sirve como sesión.
- API: `GET /api/cuentas/historial?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (los dos extremos son opcionales). Los rangos se entienden en hora de Argentina.
- **Revisión de la Dirección (web):** pestaña «Facturas» del panel del administrador. Muestra primero las facturas «En revisión», con sus ítems y los comprobantes (enlace temporal para verlos), y permite **dar por pagada** (con confirmación) o **rechazar** con un motivo obligatorio; una factura sin comprobantes solo se puede anular. Al dar por pagada, cada cuota queda registrada como pago atado a la factura y descuenta del saldo de la familia, igual que un pago cargado a mano; pagada y rechazada son estados finales. API (solo administrador): `GET /api/facturas`, `GET /api/facturas/:id`, `GET /api/facturas/comprobantes/:id/url` y `PATCH /api/facturas/:id/estado`.
- La consulta `GET /api/cuentas/cuotas?estado=historial` (lista de pagos) sigue disponible, pero la app ya no la usa.

## Notas

- Las variables `EXPO_PUBLIC_*` quedan **dentro de la app instalada**: nunca pongas contraseñas ni claves secretas.
- `npm audit` marca 5 vulnerabilidades altas en `@expo/cli` (herramientas de desarrollo, no se incluyen en la app). El arreglo que propone npm es bajar Expo a la versión 44, así que **no uses `npm audit fix --force`**.
- Expo cambia entre versiones: antes de usar una API nueva, consultá la documentación de la versión instalada (`expo` en `package.json`).
- El protocolo para trabajar con IA está en [`docs/PROTOCOLO_IA.md`](../docs/PROTOCOLO_IA.md).
