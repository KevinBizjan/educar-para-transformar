// CP-PAGO-01 · Requerimiento (HU13): el flujo inscripción → factura → pago → reporte llega a la Dirección sin perder datos.
// Actor: administrador, en el panel web. La familia se prepara por la API (es lo que hace la app móvil) para que la prueba
// se pueda repetir; la Dirección lo comprueba por la pantalla: ve la factura de la familia y el reporte de pagos la cuenta
// como deuda. Adjuntar el comprobante y aprobar la factura necesita Supabase Storage, que no existe en este entorno: ese tramo
// lo cubre `backend/tests/flujo-completo.test.js` con un almacenamiento falso.
const hoy = new Date();
const MES = hoy.getMonth() + 1;
const ANIO = hoy.getFullYear();
// El nombre de un nivel solo admite letras: se arma uno único a partir de la hora
const sufijo = String(Date.now()).split('').map((d) => String.fromCharCode(97 + Number(d))).join('');
const NIVEL = `Nivel Cobros ${sufijo}`;
const USUARIO = `e2e-cobros-${Date.now()}`;
// Clave al azar en cada corrida (cumple las reglas: mayúscula, minúscula, número y símbolo)
const CLAVE = `Aa1!${Math.random().toString(36).slice(2)}${Date.now()}`;
const CUOTA = 15000.5;
// La pantalla de facturas formatea en el navegador; los reportes vienen ya formateados del servidor ($15.000,50)
// (el navegador separa el signo del número con un espacio duro: el patrón acepta cualquier espacio)
const pesosPantalla = /\$\s*15\.000,50/;
const pesosReporte = '$15.000,50';

describe('CP-PAGO-01 · La Dirección ve lo que factura la familia y la deuda en los reportes', () => {
    const datos = {};

    before(() => {
        cy.api('admin', 'POST', '/api/auth/users', { nombre: 'Familia Cobros', username: USUARIO, password: CLAVE, rol: 'padre' })
            .then((r) => { datos.padre = r.body.id; });
        cy.api('admin', 'POST', '/api/academico/niveles', { nombre: NIVEL }).then((r) => { datos.nivel = r.body.id; });
        cy.then(() => cy.api('admin', 'POST', '/api/academico/cursos', { nivel_id: datos.nivel, division: 'A', cupo: 5 })).then((r) => { datos.curso = r.body.id; });
        cy.then(() => cy.api('admin', 'POST', '/api/academico/alumnos', {
            nombre: 'Cobros', apellido: 'Probando', dni: String(Date.now()), fecha_nacimiento: '2015-05-05', curso_id: datos.curso, tutor_id: datos.padre,
            domicilio: 'Calle 1', telefono: '3624000000', email: 'cobros@example.com',
        })).then((r) => { datos.alumno = r.body.id; });
        cy.then(() => cy.api('admin', 'POST', '/api/financiero/cuotas-config', {
            nivel_id: datos.nivel, monto: CUOTA, mes: MES, anio: ANIO, vencimiento: `${ANIO}-${String(MES).padStart(2, '0')}-10`,
        })).then((r) => { datos.cuota = r.body.id; });

        // La familia genera su factura con la cuota del mes (como lo hace la app móvil)
        cy.request('POST', '/api/auth/login', { username: USUARIO, password: CLAVE }).its('body.token').then((token) => {
            cy.request({
                method: 'POST', url: '/api/cuentas/facturas', headers: { Authorization: `Bearer ${token}` },
                body: { items: [{ tipo: 'cuota', alumno_id: datos.alumno, cuota_id: datos.cuota }] },
            }).then((r) => {
                expect(r.status).to.eq(201);
                datos.referencia = r.body.referencia;
                expect(r.body.total).to.eq(CUOTA);
            });
        });
    });

    beforeEach(() => { cy.iniciarSesion('admin'); });

    it('en 🧾 Facturas figura la factura de la familia, con su total exacto y sin comprobantes todavía', () => {
        cy.visit('/admin');
        cy.contains('button', '🧾 Facturas').click();
        cy.get('#fa-estado').select('Pendientes de pago'); // por defecto muestra solo las que esperan revisión
        cy.contains('tr', datos.referencia).within(() => {
            cy.contains('Familia Cobros');
            cy.contains(pesosPantalla);
            cy.contains('Pendiente de pago');
            cy.contains('button', 'Ver').click();
        });
        cy.contains('La familia todavía no adjuntó ningún comprobante.');
        cy.contains('button', 'Dar por pagada').should('not.exist');
    });

    it('el reporte «Pagos por alumno» cuenta la cuota facturada como deuda: el alumno figura como Incompleto', () => {
        cy.visit('/admin');
        cy.contains('button', '📊 Reportes').click();
        cy.get('#reporte-id').select('Pagos por alumno (completos o incompletos)');
        cy.get('#rep-nivel_id').select(NIVEL);
        cy.contains('button', 'Generar reporte').click();
        cy.contains('tr', 'Probando').within(() => {
            cy.contains('Incompleto');
            cy.contains(pesosReporte);
        });
        cy.contains('TOTAL (1 alumnos)');
    });
});
