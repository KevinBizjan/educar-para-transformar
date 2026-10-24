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

## Comprobar sin celular

```bash
npm test                   # 18 pruebas: cliente de la API, sesión y validaciones (sin red)
npm run verificar:conexion # llama al backend real: GET /api/health
```

## Estructura

| Ruta | Qué hay |
|---|---|
| `App.js` | Raíz de la app: redirige según la sesión y el rol |
| `src/auth/` | Sesión: login, renovación y cierre (`sesion.js`), contexto de React y almacenamiento seguro del token |
| `src/screens/` | Pantallas: inicio de sesión, inicio del padre/tutor, cambio de contraseña y acceso no disponible |
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

## Notas

- Las variables `EXPO_PUBLIC_*` quedan **dentro de la app instalada**: nunca pongas contraseñas ni claves secretas.
- `npm audit` marca 5 vulnerabilidades altas en `@expo/cli` (herramientas de desarrollo, no se incluyen en la app). El arreglo que propone npm es bajar Expo a la versión 44, así que **no uses `npm audit fix --force`**.
- Expo cambia entre versiones: antes de usar una API nueva, consultá la documentación de la versión instalada (`expo` en `package.json`).
- El protocolo para trabajar con IA está en [`docs/PROTOCOLO_IA.md`](../docs/PROTOCOLO_IA.md).
