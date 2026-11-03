// Lógica de los comprobantes de transferencia en la app (HU8): validar el archivo elegido, leerlo y subirlo al
// servidor (que lo valida de nuevo y lo guarda en Storage). Sin dependencias de React ni de Expo, para poder
// probarla con Node: el lector de archivos y fetch se reciben como parámetros.
import { apiFetch } from '../api/client.js';

export const TIPOS_PERMITIDOS = ['image/png', 'image/jpeg', 'application/pdf'];
export const MAX_BYTES = 5 * 1024 * 1024;
const POR_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };

// El selector de archivos a veces no informa el tipo (o dice "image/jpg"): se completa con la extensión.
export const inferirTipo = ({ name, mimeType } = {}) => {
    const declarado = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    if (TIPOS_PERMITIDOS.includes(declarado)) return declarado;
    const extension = String(name || '').toLowerCase().split('.').pop();
    return POR_EXTENSION[extension] || null;
};

// "1,2 MB", "340 KB" o "512 B"
export const describirTamano = (bytes) => {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
};

// Revisión previa a subir, para avisar enseguida sin gastar datos. El servidor la repite (y revisa el contenido).
export const validarLocal = (archivo) => {
    if (!archivo || !archivo.uri) return 'No se pudo leer el archivo elegido';
    if (!inferirTipo(archivo)) return 'Elegí un archivo PNG, JPG o PDF';
    if (archivo.size === 0) return 'El archivo está vacío';
    if (archivo.size > MAX_BYTES) return `El archivo pesa ${describirTamano(archivo.size)} y el máximo es 5 MB`;
    return null;
};

// Lee un archivo del teléfono como base64 (sin el prefijo "data:...").
export async function leerComoBase64(uri, { fetchFn = globalThis.fetch, Lector = globalThis.FileReader } = {}) {
    const blob = await (await fetchFn(uri)).blob();
    return new Promise((resolve, reject) => {
        const lector = new Lector();
        lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
        lector.onload = () => {
            const texto = String(lector.result || '');
            const coma = texto.indexOf(',');
            if (coma < 0) return reject(new Error('No se pudo leer el archivo'));
            resolve(texto.slice(coma + 1));
        };
        lector.readAsDataURL(blob);
    });
}

// Sube el archivo elegido a una factura. Devuelve { comprobante, factura_estado }.
export async function subirComprobante(facturaId, archivo, deps = {}) {
    const error = validarLocal(archivo);
    if (error) throw new Error(error);
    const contenido = await leerComoBase64(archivo.uri, deps);
    return apiFetch(`/api/cuentas/facturas/${facturaId}/comprobantes`, {
        metodo: 'POST',
        cuerpo: { nombre: archivo.name, tipo_mime: inferirTipo(archivo), contenido },
        tiempoEsperaMs: 120000, // subir una foto con datos móviles puede tardar
    });
}

export const listarComprobantes = (facturaId) => apiFetch(`/api/cuentas/facturas/${facturaId}/comprobantes`);
export const urlComprobante = (comprobanteId) => apiFetch(`/api/cuentas/comprobantes/${comprobanteId}/url`);
export const borrarComprobante = (comprobanteId) => apiFetch(`/api/cuentas/comprobantes/${comprobanteId}`, { metodo: 'DELETE' });

// ¿La factura todavía admite adjuntar o quitar comprobantes?
export const admiteComprobantes = (estado) => estado === 'Pendiente' || estado === 'En revision';
