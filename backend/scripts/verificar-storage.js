// Comprueba que el backend llega al bucket de Supabase Storage con la configuración de backend/.env:
// sube una imagen de prueba, genera su enlace temporal, la descarga y la borra. No imprime claves ni enlaces.
// Uso:  npm run verificar:storage
require('dotenv').config();
const { almacenDesdeEntorno } = require('../src/services/almacenamiento');

// PNG de 1x1 píxel
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

(async () => {
    const almacen = almacenDesdeEntorno();
    if (!almacen) {
        console.error('✖ Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY en backend/.env (ver backend/.env.example).');
        process.exit(1);
    }
    const ruta = `verificacion/${Date.now()}.png`;
    let subido = false;
    try {
        await almacen.subir(ruta, PNG, 'image/png');
        subido = true;
        console.log('✔ Subida correcta al bucket');
        const respuesta = await fetch(await almacen.urlFirmada(ruta, 60));
        const bytes = Buffer.from(await respuesta.arrayBuffer());
        if (!respuesta.ok || !bytes.equals(PNG)) throw new Error(`la descarga con el enlace firmado falló (HTTP ${respuesta.status})`);
        console.log('✔ Enlace temporal firmado: la descarga devuelve el mismo archivo');
    } catch (error) {
        console.error(`✖ ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (subido) {
            await almacen.borrar(ruta).then(() => console.log('✔ Archivo de prueba borrado'), (e) => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
        }
    }
})();
