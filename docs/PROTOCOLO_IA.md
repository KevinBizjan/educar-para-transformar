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
| 2 | HU2 | Configurar el cliente móvil con Expo, consumir la API REST y usar Supabase solo para Storage | Proyecto Expo, cliente de la API, cliente de Supabase, pantalla de conexión y 6 pruebas | Sí: conecta al backend real y compila | Se quitaron archivos de la plantilla (`.claude`, `AGENTS.md`, `LICENSE`); se agregó la extensión `.js` a los imports para poder probar con Node; no se aplicó `npm audit fix --force` | Correcto, con ajustes |

Cada nueva HU suma una fila: qué se pidió, qué devolvió la IA, si funcionó, qué hubo que corregir a mano y el resultado (**Correcto**, **Parcialmente correcto** o **Incorrecto**).

## 5. Riesgos que ya vimos

- **Paquetes o APIs desactualizadas o inventadas:** se verifican contra la documentación oficial antes de usarlas.
- **Código que funciona pero no se entiende:** se simplifica o se rehace.
- **Archivos de configuración de plantillas:** se revisan y se quita lo que no corresponde al proyecto (por ejemplo, plugins o licencias ajenas).
