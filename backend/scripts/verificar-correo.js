// Comprueba que el backend puede enviar correos con la configuración de backend/.env (Resend): manda un mensaje de prueba.
// No imprime la clave. Uso:  npm run verificar:correo -- tu@correo.com
// Con el remitente de prueba de Resend (onboarding@resend.dev) solo se puede escribir al correo de tu propia cuenta de Resend;
// para escribirle a las familias hay que verificar un dominio y poner su remitente en MAIL_FROM.
require('dotenv').config();
const { proveedorDesdeEntorno } = require('../src/services/correo');

(async () => {
    const proveedor = proveedorDesdeEntorno();
    if (!proveedor) {
        console.error('✖ Falta RESEND_API_KEY en backend/.env (ver backend/.env.example).');
        process.exit(1);
    }
    const para = process.argv[2] || process.env.MAIL_REDIRIGIR_A;
    if (!para) {
        console.error('✖ Indicá el destinatario: npm run verificar:correo -- tu@correo.com');
        process.exit(1);
    }
    try {
        const { id } = await proveedor.enviar({
            para,
            asunto: 'Prueba de correo · Educar para Transformar',
            html: '<p>Si estás leyendo esto, el servidor de <strong>Educar para Transformar</strong> puede enviar correos.</p>',
            texto: 'Si estás leyendo esto, el servidor de Educar para Transformar puede enviar correos.',
        });
        console.log(`✔ Correo enviado${proveedor.redirigeA ? ` (redirigido a ${proveedor.redirigeA})` : ` a ${para}`}. Id del proveedor: ${id}`);
    } catch (error) {
        console.error(`✖ ${error.message}`);
        process.exitCode = 1;
    }
})();
