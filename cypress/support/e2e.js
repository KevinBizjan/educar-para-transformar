// Comandos compartidos por todas las pruebas E2E.
import { USUARIOS } from './usuarios';

// Inicia sesión por la pantalla de login, como lo haría una persona. cy.session guarda la sesión: se repite solo una vez por rol.
Cypress.Commands.add('iniciarSesion', (rol) => {
    const { usuario, clave, panel } = USUARIOS[rol];
    cy.session(rol, () => {
        cy.visit('/login');
        cy.get('input[placeholder="Tu usuario"]').type(usuario);
        cy.get('input[type="password"]').type(clave, { log: false });
        cy.contains('button', 'Iniciar Sesión').click();
        cy.location('pathname').should('eq', panel);
    });
});

// Token de la API de un rol (para preparar datos de la prueba sin pasar por la pantalla).
Cypress.Commands.add('tokenDe', (rol) => {
    const { usuario, clave } = USUARIOS[rol];
    return cy.request('POST', '/api/auth/login', { username: usuario, password: clave }).its('body.token');
});

// Llamada a la API con el token de un rol.
Cypress.Commands.add('api', (rol, metodo, url, cuerpo) => {
    cy.tokenDe(rol).then((token) => cy.request({
        method: metodo, url, body: cuerpo, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false,
    }));
});
