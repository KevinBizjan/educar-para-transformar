// Reglas puras de los comprobantes de transferencia (HU8): qué archivos se aceptan y cómo se reconocen de verdad.
// No alcanza con mirar la extensión ni el tipo que declara la app: se revisa el contenido (los primeros y los últimos
// bytes) para rechazar formatos falsos y archivos cortados. Sin base de datos ni red, para poder probarlas con Node.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB por archivo
const MAX_POR_FACTURA = 10; // "1 a N comprobantes por factura"
const EXTENSIONES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

const empieza = (buffer, bytes) => buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
const contieneAlFinal = (buffer, texto, ventana) => buffer.subarray(Math.max(0, buffer.length - ventana)).includes(Buffer.from(texto, 'latin1'));

// Tipo real del archivo según su contenido, o null si no es PNG, JPG ni PDF.
const detectarTipo = (buffer) => {
    if (empieza(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (empieza(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (empieza(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
    return null;
};

// ¿Está completo? Cada formato termina con una marca: el chunk IEND de PNG, el EOI (FFD9) de JPG y el %%EOF de PDF.
const estaCompleto = (buffer, tipo) => {
    if (tipo === 'image/png') return buffer.length >= 20 && buffer.subarray(buffer.length - 8).equals(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
    if (tipo === 'image/jpeg') return buffer.length >= 4 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
    return contieneAlFinal(buffer, '%%EOF', 1024);
};

// Base64 estricto (con o sin el prefijo "data:...;base64,"). Devuelve el Buffer o null.
const decodificarBase64 = (texto) => {
    if (typeof texto !== 'string') return null;
    const limpio = texto.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
    if (!limpio || limpio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) return null;
    return Buffer.from(limpio, 'base64');
};

// Nombre que se guarda y se muestra: sin barras ni caracteres de control, acotado.
const nombreSeguro = (nombre, extension) => {
    const limpio = String(nombre || '').replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 120);
    return limpio || `comprobante.${extension}`;
};

// Valida lo que manda la app: { nombre, tipo_mime, contenido }. Devuelve { buffer, tipo, nombre } o { error, estado }.
const validarArchivo = ({ nombre, tipo_mime: declarado, contenido } = {}) => {
    if (!EXTENSIONES[declarado]) return { estado: 400, error: 'Solo se aceptan archivos PNG, JPG o PDF' };
    const buffer = decodificarBase64(contenido);
    if (!buffer) return { estado: 400, error: 'El contenido del archivo no es válido' };
    if (buffer.length === 0) return { estado: 400, error: 'El archivo está vacío' };
    if (buffer.length > MAX_BYTES) return { estado: 413, error: 'El archivo supera los 5 MB' };
    const real = detectarTipo(buffer);
    if (!real) return { estado: 400, error: 'Solo se aceptan archivos PNG, JPG o PDF' };
    if (real !== declarado) return { estado: 400, error: 'El archivo no coincide con el formato indicado' };
    if (!estaCompleto(buffer, real)) return { estado: 400, error: 'El archivo está dañado o incompleto' };
    return { buffer, tipo: real, nombre: nombreSeguro(nombre, EXTENSIONES[real]) };
};

// Ruta dentro del bucket: <padre>/<factura>/<azar>.<extensión>. El azar evita que se pisen o se adivinen.
const rutaStorage = (padreId, facturaId, tipo, azar) => `${padreId}/${facturaId}/${azar}.${EXTENSIONES[tipo]}`;

module.exports = { MAX_BYTES, MAX_POR_FACTURA, EXTENSIONES, detectarTipo, estaCompleto, decodificarBase64, nombreSeguro, validarArchivo, rutaStorage };
