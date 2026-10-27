// CP-INS-01 · Requerimiento: "Cada alumno puede inscribirse a dos deportes simultáneamente" y
//             "El sistema deberá controlar que no existan conflictos de horarios entre las actividades deportivas".
// Actor: padre/tutor, desde "Servicios de mis hijos". Los datos se preparan por la API para que la prueba se pueda repetir.
const hoy = new Date();
const MES = hoy.getMonth() + 1;
const ANIO = hoy.getFullYear();
const NOMBRE_GRUPO_PRUEBA = 'Vóley Primario · lunes 17:00 (prueba E2E)';

// Hace clic en "Inscribir" de la tarjeta del deporte y confirma en la ventana.
const inscribirEn = (deporte) => {
    cy.contains('p', new RegExp(`^${deporte}$`)).parent().contains('button', 'Inscribir').click();
    cy.contains('h2', 'Confirmar inscripción').parent().contains('button', 'Inscribir').click();
};

describe('CP-INS-01 · Inscripción a deportes: máximo 2 por mes y sin conflictos de horario', () => {
    let hijoId;
    let grupoPruebaId;
    const servicio = {};

    before(() => {
        // 1) El padre tiene vinculada a su hija Lucía (si no, se vincula).
        cy.api('padre', 'GET', '/api/academico/mis-hijos').then((r) => {
            const vinculada = r.body.find((h) => h.nombre === 'Lucía');
            if (vinculada) return vinculada.id;
            return cy.api('padre', 'GET', '/api/academico/alumnos-disponibles').then((d) => {
                const id = d.body.find((a) => a.nombre === 'Lucía').id;
                return cy.api('padre', 'POST', '/api/academico/vincular-hijo', { alumno_id: id }).then(() => id);
            });
        }).then((id) => { hijoId = id; });

        // 2) Parte sin inscripciones en el mes: se dan de baja las que hubiera.
        cy.then(() => cy.api('padre', 'GET', `/api/inscripciones/alumno/${hijoId}?mes=${MES}&anio=${ANIO}`)).then((r) => {
            r.body.forEach((i) => cy.api('padre', 'DELETE', `/api/inscripciones/${i.id}`));
        });

        // 3) Servicios del catálogo que se usan en la prueba.
        cy.api('padre', 'GET', '/api/inscripciones/catalogo').then((r) => {
            const por = (texto) => r.body.servicios.find((s) => s.nombre.includes(texto)).id;
            servicio.futbol = por('Fútbol Primario');
            servicio.natacion = por('Natación Primario');
            servicio.basquet = por('Básquet Primario');
        });

        // 4) Un grupo de Vóley para Primario el lunes de 17:00 a 18:00, que se pisa con el fútbol del lunes (16:00 a 17:30).
        cy.api('admin', 'GET', '/api/academico/actividades').then((r) => r.body.find((a) => a.nombre === 'Vóley').id).then((actividadId) => {
            cy.api('admin', 'GET', '/api/academico/docentes').then((d) => d.body.find((x) => x.apellido === 'Pérez').id).then((docenteId) => {
                cy.api('admin', 'GET', '/api/academico/niveles').then((n) => n.body.find((x) => x.nombre === 'Primario').id).then((nivelId) => {
                    cy.api('admin', 'POST', '/api/inscripciones/servicios', {
                        tipo: 'Deporte', nombre: NOMBRE_GRUPO_PRUEBA, precio_mensual: 1000, cupo_max: 10,
                        actividad_id: actividadId, docente_id: docenteId, nivel_id: nivelId, dia_semana: 1, hora_inicio: '17:00', hora_fin: '18:00',
                    });
                });
            });
        });
        cy.api('admin', 'GET', '/api/inscripciones/servicios').then((r) => {
            grupoPruebaId = r.body.servicios.find((s) => s.nombre === NOMBRE_GRUPO_PRUEBA).id;
        });
        // Si el grupo ya existía de una ejecución anterior (la prueba lo deja desactivado), se vuelve a activar: la prueba se puede repetir.
        cy.then(() => cy.api('admin', 'PATCH', `/api/inscripciones/servicios/${grupoPruebaId}`, { activo: true }));
    });

    after(() => {
        // Se deja el catálogo como estaba: el grupo de prueba se desactiva y se dan de baja las inscripciones.
        cy.api('admin', 'PATCH', `/api/inscripciones/servicios/${grupoPruebaId}`, { activo: false });
        cy.api('padre', 'GET', `/api/inscripciones/alumno/${hijoId}?mes=${MES}&anio=${ANIO}`).then((r) => {
            r.body.forEach((i) => cy.api('padre', 'DELETE', `/api/inscripciones/${i.id}`));
        });
    });

    beforeEach(() => {
        cy.iniciarSesion('padre');
        cy.visit('/padre#servicios');
        cy.contains('h3', 'Servicios de mis hijos').should('be.visible');
    });

    it('CP-INS-01.1 inscribe a la hija en dos deportes distintos', () => {
        inscribirEn('Fútbol');
        cy.contains('quedó inscripto/a en Fútbol').should('be.visible');
        inscribirEn('Natación');
        cy.contains('quedó inscripto/a en Natación').should('be.visible');
        cy.contains('Deportes · 2 de 2 posibles').should('be.visible');
        cy.screenshot('CP-INS-01.1_dos_deportes_inscriptos');
    });

    it('CP-INS-01.2 el tercer deporte queda bloqueado en la pantalla', () => {
        cy.contains('p', /^Básquet$/).parent().contains('button', 'Máximo alcanzado').should('be.disabled');
        cy.screenshot('CP-INS-01.2_tercer_deporte_bloqueado');
    });

    it('CP-INS-01.3 el servidor también rechaza el tercer deporte aunque se evite la pantalla', () => {
        cy.api('padre', 'POST', '/api/inscripciones', { alumno_id: hijoId, servicio_id: servicio.basquet, mes: MES, anio: ANIO }).then((r) => {
            expect(r.status).to.eq(409);
            expect(r.body.message).to.include('máximo en 2 deportes');
        });
        cy.api('padre', 'GET', `/api/inscripciones/alumno/${hijoId}?mes=${MES}&anio=${ANIO}`).then((r) => {
            expect(r.body.filter((i) => i.tipo === 'Deporte')).to.have.length(2);
        });
    });

    it('CP-INS-01.4 dar de baja un deporte libera el lugar para otro', () => {
        cy.contains('p', /^Natación$/).parent().contains('button', 'Dar de baja').click();
        cy.contains('se dio de baja de Natación').should('be.visible');
        cy.contains('Deportes · 1 de 2 posibles').should('be.visible');
        cy.contains('p', /^Básquet$/).parent().contains('button', 'Inscribir').should('not.be.disabled');
    });

    it('CP-INS-02 no permite dos deportes cuyos horarios se superponen', () => {
        // Fútbol (lunes 16:00 a 17:30) ya está inscripto; el Vóley de prueba es el lunes de 17:00 a 18:00.
        inscribirEn('Vóley');
        cy.contains('El horario se superpone con').should('be.visible');
        cy.contains('Deportes · 1 de 2 posibles').should('be.visible');
        cy.screenshot('CP-INS-02_conflicto_de_horario');
    });
});
