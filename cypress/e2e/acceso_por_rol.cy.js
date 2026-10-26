import { USUARIOS } from '../support/usuarios';

// Pruebas de humo / regresión: lo básico que nunca debe dejar de funcionar.
// Se ejecutan completas en cada Pull Request: si un cambio rompe el ingreso o la navegación, se detecta antes de mergear.
describe('Acceso por rol (regresión)', () => {
    const roles = ['admin', 'docente', 'alumno', 'padre'];

    roles.forEach((rol) => {
        it(`el rol ${rol} ingresa y llega a su propio panel`, () => {
            cy.iniciarSesion(rol);
            cy.visit(USUARIOS[rol].panel);
            cy.location('pathname').should('eq', USUARIOS[rol].panel);
        });
    });

    it('sin iniciar sesión, un panel protegido redirige al login', () => {
        cy.visit('/padre');
        cy.location('pathname').should('eq', '/login');
    });

    it('un rol no entra al panel de otro rol', () => {
        cy.iniciarSesion('padre');
        cy.visit('/admin');
        cy.location('pathname').should('not.eq', '/admin');
    });
});

describe('Panel del padre con accesos (regresión)', () => {
    beforeEach(() => {
        cy.iniciarSesion('padre');
        cy.visit('/padre');
    });

    it('muestra un acceso por sección en lugar de una página larga', () => {
        cy.get('.acceso').should('have.length', 7);
        cy.contains('.acceso', 'Servicios de mis hijos').should('be.visible');
        cy.contains('.acceso', 'Cuenta y pagos').should('be.visible');
    });

    it('abre una sección, deja su dirección y vuelve al inicio', () => {
        cy.contains('.acceso', 'Cuenta y pagos').click();
        cy.location('hash').should('eq', '#cuenta');
        cy.contains('h3', 'Estado de Cuenta').should('be.visible');
        cy.get('.accesos').should('not.exist');
        cy.contains('button', 'Volver al panel').click();
        cy.location('hash').should('eq', '');
        cy.get('.acceso').should('have.length', 7);
    });
});
