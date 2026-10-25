const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middlewares
// Permitir todos los orígenes para desarrollo local. Content-Disposition se expone para que el front pueda
// leer el nombre de archivo de las descargas (reportes en CSV) también entre orígenes distintos.
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());
app.use(morgan('dev'));

// Rutas
const authRoutes = require('./routes/auth.routes');
const preinscripcionRoutes = require('./routes/preinscripcion.routes');

app.use('/api/auth', authRoutes);
app.use('/api/preinscripciones', preinscripcionRoutes);
app.use('/api/academico', require('./routes/academico.routes'));
app.use('/api/financiero', require('./routes/financiero.routes'));
app.use('/api/servicios', require('./routes/servicios.routes'));
app.use('/api/comunicacion', require('./routes/comunicacion.routes'));
app.use('/api/inscripciones', require('./routes/inscripciones.routes'));
app.use('/api/reportes', require('./routes/reportes.routes'));

// Health check de la API (útil para monitoreo del deploy)
app.get('/api/health', (req, res) => {
    res.json({ message: 'API Educar para Transformar - Activa' });
});

// --- Servir el frontend compilado (despliegue de un solo servicio) ---
// En producción Express sirve el build de Vite (frontend/dist) desde el mismo
// dominio, así no hay CORS ni una segunda URL que coordinar.
// En desarrollo esta carpeta no existe y el bloque se omite (usas `vite dev`).
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // Fallback SPA: cualquier ruta que NO sea /api/* devuelve index.html
    // para que React Router maneje el enrutamiento del lado del cliente.
    app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

module.exports = app;
