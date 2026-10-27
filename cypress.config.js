// Pruebas de extremo a extremo (E2E) con Cypress: simulan a una persona usando la aplicación en un navegador real.
// Requieren la aplicación corriendo (el backend sirve el frontend compilado) y la base cargada con `npm run seed --prefix backend`.
const { defineConfig } = require('cypress');

module.exports = defineConfig({
    e2e: {
        // Misma dirección para la pantalla y la API (el backend sirve el frontend compilado).
        baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3917',
        specPattern: 'cypress/e2e/**/*.cy.js',
        supportFile: 'cypress/support/e2e.js',
        viewportWidth: 1280,
        viewportHeight: 800,
        defaultCommandTimeout: 8000,
        video: false,
        screenshotsFolder: 'cypress/screenshots',
        // Un error de la aplicación no se ignora: si algo se rompe, la prueba debe fallar.
        retries: { runMode: 0, openMode: 0 },
    },
});
