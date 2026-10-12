const app = require('./app');
const db = require('./config/database');

const PORT = process.env.PORT || 3000;

// Sin JWT_SECRET se firma con una clave de desarrollo que es pública (está en el
// código): cualquiera podría fabricar tokens. En producción debe estar definida.
if (!process.env.JWT_SECRET) {
    console.warn('ADVERTENCIA: JWT_SECRET no está definida. Se usa la clave de desarrollo; definila en las variables de entorno.');
}

// Siembra opcional al arrancar (idempotente: usa ON CONFLICT DO NOTHING y chequeos).
// Se activa con SEED_ON_BOOT=true. Crea usuarios demo con contraseñas conocidas
// (ver DEPLOY_RAILWAY.md): fuera de una demo conviene dejarla en false.
if (process.env.SEED_ON_BOOT === 'true') {
    const seed = require('../seed');
    // Espera a que database.js termine de verificar el esquema antes de sembrar.
    db.ready
        .then(() => seed())
        .catch((err) => console.error('Error en seed inicial:', err));
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
