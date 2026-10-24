// Comprueba contra el backend REAL que el cliente móvil llega a la API.
// Uso: npm run verificar:conexion   (o con otra URL: EXPO_PUBLIC_API_URL=http://localhost:3000 npm run verificar:conexion)
import { verificarConexion } from '../src/api/client.js';

try {
    const r = await verificarConexion();
    console.log(`Conectado a ${r.url}\n  Respuesta: "${r.mensaje}"\n  Demora: ${r.demoraMs} ms`);
} catch (e) {
    console.error(`No se pudo conectar: ${e.message}`);
    process.exitCode = 1;
}
