# Protocolo de trabajo con IA

Cómo usamos asistentes de IA para programar la app móvil y cómo validamos lo que generan. La IA propone; **nosotras decidimos y respondemos por el código**.

## 1. Flujo de trabajo

1. Se toma una historia de usuario (issue) y se copia al prompt con sus **criterios de aceptación**.
2. La IA genera el código en una rama propia (`feat/...`), nunca directo en `main`.
3. Se aplica la **checklist de validación** (sección 3).
4. Se abre un Pull Request con `Closes #n`; la CI (lint, build y pruebas) tiene que estar en verde.
5. La otra integrante revisa antes de mergear.
6. Se completa la **bitácora** (sección 4).

## 2. Qué se le puede y qué no se le puede dar a la IA

| Sí | No |
|---|---|
| Criterios de aceptación de la HU | Contraseñas, tokens, claves secretas o la cadena de conexión de la base |
| Fragmentos de código y mensajes de error | Datos personales reales de alumnos o familias |
| Estructura del proyecto y convenciones | El archivo `.env` completo |

Si un secreto se pegó por error, se rota de inmediato (Supabase → resetear contraseña; nueva `JWT_SECRET`).

## 3. Checklist de validación del código generado

Nada se mergea sin cumplir **todo** esto:

- [ ] **Se entiende.** Podemos explicar cada parte; si no, se pide que la simplifique o se descarta.
- [ ] **Se ejecuta.** `npm test` en verde y la app compila (`npx expo export --platform android` en `mobile/`, `npm run build` en `frontend/`).
- [ ] **Casos de borde.** Se prueban datos vacíos, inválidos y los límites de los criterios de aceptación.
- [ ] **Seguridad.** Sin secretos en el código; la validación y los permisos (RBAC) están en el **servidor**, no solo en la app; las consultas SQL usan parámetros.
- [ ] **Dependencias reales.** Cada paquete nuevo existe, tiene la versión correcta y se justifica. En Expo se instalan con `npx expo install` (resuelve la versión compatible con el SDK).
- [ ] **Documentación al día.** Para Expo y React Native se consulta la documentación de la **versión instalada**: las APIs cambian entre versiones y la IA puede conocer una anterior.
- [ ] **Revisión cruzada.** La otra integrante lo revisa en el PR.

## 4. Bitácora de uso de IA

| ID | HU | Prompt (resumen) | Respuesta de la IA | ¿Funcionó? | Modificaciones | Resultado |
|---|---|---|---|---|---|---|
| 1 | HU1 | Extender el modelo con facturas, comprobantes, servicios e inscripciones, según los criterios de la HU | 5 tablas nuevas con restricciones y RLS, y 14 pruebas | Sí, verificado contra PostgreSQL 17 (55 de 55 pruebas) | Ninguna en el código | Correcto |
| 2 | HU2 | Configurar el cliente móvil con Expo, consumir la API REST y usar Supabase solo para Storage | Proyecto Expo, cliente de la API, cliente de Supabase, pantalla de conexión y 6 pruebas | Sí: conecta al backend real y compila | Se quitaron archivos de la plantilla (la configuración de plugins, `AGENTS.md`, `LICENSE`); se agregó la extensión `.js` a los imports para poder probar con Node; no se aplicó `npm audit fix --force` | Correcto, con ajustes |
| 3 | HU3 | Autenticación móvil: login, logout, refresco de token y cambio de contraseña, sin duplicar credenciales | Endpoints `/refresh` y `/change-password` en el backend, lógica de sesión y pantallas en la app, 8 pruebas de backend y 12 de la app | Sí: 63 pruebas del backend y 18 de la app en verde; flujo completo contra el backend real (13 comprobaciones) | Se cambió `SafeAreaView` (deprecado) por `react-native-safe-area-context`; una contraseña actual incorrecta responde 400 y no 401, para que la app no la confunda con una sesión vencida | Correcto, con ajustes |
| 4 | HU4 | Lógica de inscripciones a servicios: máximo 2 deportes, transporte por recorrido y mes, y cupos | Endpoints de catálogo, inscripción, baja y administración de servicios; reglas en una transacción con bloqueo de filas; 14 pruebas de la API y 5 de reglas puras | Sí: 81 pruebas del backend en verde, 3 corridas seguidas | Al quitar los bloqueos a propósito, las 2 pruebas de concurrencia fallaron: confirma que detectan la carrera y que el bloqueo la evita | Correcto |
| 5 | HU5 | Pantalla "Mis hijos" con servicios del mes, consumo del comedor y estado de cuenta, cargando rápido | Endpoint único `/resumen-familia` (3 consultas, 2 en paralelo), lógica con caché y 3 pantallas nuevas en la app, 9 pruebas del backend y 9 de la app | Sí: 90 pruebas del backend y 27 de la app en verde; flujo contra el backend real con una familia de 3 hijos (media de 4 ms en local) | Se unificó el nombre del servicio en pantalla ("Comedor mensual" salía como "Comedor: Comedor mensual") y se pasaron a paralelo las dos consultas independientes | Correcto, con ajustes |

Cada nueva HU suma una fila: qué se pidió, qué devolvió la IA, si funcionó, qué hubo que corregir a mano y el resultado (**Correcto**, **Parcialmente correcto** o **Incorrecto**).

## 5. Riesgos que ya vimos

- **Paquetes o APIs desactualizadas o inventadas:** se verifican contra la documentación oficial antes de usarlas.
- **Código que funciona pero no se entiende:** se simplifica o se rehace.
- **Archivos de configuración de plantillas:** se revisan y se quita lo que no corresponde al proyecto (por ejemplo, plugins o licencias ajenas).
