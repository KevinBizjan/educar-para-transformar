// Almacenamiento de los comprobantes en Supabase Storage (HU8). El bucket es PRIVADO: los archivos solo se ven con
// una dirección firmada que vence. El backend es el único que habla con Storage (con la clave secreta del servidor,
// que nunca va a la app): así valida cada archivo antes de guardarlo y lo asocia a una factura.
const { createClient } = require('@supabase/supabase-js');

class AlmacenError extends Error {}

// Interfaz: { subir(ruta, buffer, tipo), urlFirmada(ruta, segundos), borrar(ruta) }
function crearAlmacenSupabase({ url, clave, bucket = 'comprobantes', cliente }) {
    const storage = (cliente || createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } })).storage.from(bucket);
    const fallo = (que, error) => new AlmacenError(`${que}: ${error.message || error}`);
    return {
        async subir(ruta, buffer, tipo) {
            const { error } = await storage.upload(ruta, buffer, { contentType: tipo, upsert: false });
            if (error) throw fallo('No se pudo guardar el archivo', error);
        },
        async urlFirmada(ruta, segundos = 600) {
            const { data, error } = await storage.createSignedUrl(ruta, segundos);
            if (error || !data) throw fallo('No se pudo generar el enlace', error || 'sin respuesta');
            return data.signedUrl;
        },
        async borrar(ruta) {
            const { error } = await storage.remove([ruta]);
            if (error) throw fallo('No se pudo borrar el archivo', error);
        },
    };
}

// Toma la configuración del servidor; sin ella el almacenamiento no está disponible (null).
const almacenDesdeEntorno = (env = process.env) => (
    env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY
        ? crearAlmacenSupabase({ url: env.SUPABASE_URL, clave: env.SUPABASE_SERVICE_KEY, bucket: env.SUPABASE_BUCKET || 'comprobantes' })
        : null
);

let almacen;
const obtenerAlmacen = () => {
    if (almacen === undefined) almacen = almacenDesdeEntorno();
    return almacen;
};
// Para las pruebas: reemplaza el almacén por uno falso (o por null para simular que no está configurado).
const usarAlmacen = (nuevo) => { almacen = nuevo; };

module.exports = { AlmacenError, crearAlmacenSupabase, almacenDesdeEntorno, obtenerAlmacen, usarAlmacen };
