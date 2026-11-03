// Envío de correos con Resend (HU10). El backend es el único que habla con el proveedor, con la clave de la
// configuración del servidor. Interfaz: enviar({ para, asunto, html, texto, adjuntos }) -> { id }.
class CorreoError extends Error {}

const URL_RESEND = 'https://api.resend.com/emails';
const REMITENTE_POR_DEFECTO = 'Educar para Transformar <onboarding@resend.dev>';

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function crearProveedorResend({ clave, desde = REMITENTE_POR_DEFECTO, redirigirA = '', fetchFn = globalThis.fetch, pausaReintentoMs = 1200 }) {
    return {
        redirigeA: redirigirA || null,
        async enviar({ para, asunto, html, texto, adjuntos = [] }) {
            // Con redirección (pruebas y demostración) todo llega a una sola casilla y el asunto indica a quién iba
            const destino = redirigirA || para;
            const cuerpo = {
                from: desde,
                to: [destino],
                subject: redirigirA ? `[Para ${para}] ${asunto}` : asunto,
                html,
                text: texto,
                ...(adjuntos.length ? { attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido.toString('base64') })) } : {}),
            };
            for (let intento = 0; ; intento++) {
                let respuesta;
                try {
                    respuesta = await fetchFn(URL_RESEND, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(cuerpo),
                    });
                } catch (err) {
                    throw new CorreoError(`No se pudo conectar con el servicio de correo: ${err.message}`);
                }
                // Resend limita a 2 pedidos por segundo: ante un 429 se espera y se reintenta una vez
                if (respuesta.status === 429 && intento === 0) { await esperar(pausaReintentoMs); continue; }
                let datos = null;
                try { datos = await respuesta.json(); } catch { /* sin JSON */ }
                if (!respuesta.ok) throw new CorreoError(`El servicio de correo respondió ${respuesta.status}: ${(datos && datos.message) || 'sin detalle'}`);
                return { id: (datos && datos.id) || null };
            }
        },
    };
}

// Toma la configuración del servidor; sin clave el envío de correos no está disponible (null).
const proveedorDesdeEntorno = (env = process.env) => (
    env.RESEND_API_KEY
        ? crearProveedorResend({ clave: env.RESEND_API_KEY, desde: env.MAIL_FROM || REMITENTE_POR_DEFECTO, redirigirA: env.MAIL_REDIRIGIR_A || '' })
        : null
);

let proveedor;
const obtenerProveedor = () => {
    if (proveedor === undefined) proveedor = proveedorDesdeEntorno();
    return proveedor;
};
// Para las pruebas: reemplaza el proveedor por uno falso (o por null para simular que no está configurado).
const usarProveedor = (nuevo) => { proveedor = nuevo; };

module.exports = { CorreoError, crearProveedorResend, proveedorDesdeEntorno, obtenerProveedor, usarProveedor, REMITENTE_POR_DEFECTO };
