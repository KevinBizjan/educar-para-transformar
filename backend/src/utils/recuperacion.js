// Recuperación de contraseña por correo (app móvil): reglas puras del código de un solo uso. Sin base de datos ni red.
// El usuario pide un código de 6 dígitos, le llega por correo y lo escribe en la app junto con la contraseña nueva.
//  - El código vale 15 minutos y se puede equivocar hasta 5 veces; después hay que pedir otro.
//  - Se guarda solo su huella (HMAC con el secreto del servidor), nunca el código.
//  - Se pide como máximo uno por minuto por cuenta.
const crypto = require('node:crypto');
const { escapar } = require('./correos');

const MINUTOS_VIGENCIA = 15;
const MAX_INTENTOS = 5;
const ESPERA_SEGUNDOS = 60;
const LARGO_CODIGO = 6;

// Respuesta que se da siempre al pedir el código, exista o no la cuenta: no se revela quién tiene cuenta
const MENSAJE_PEDIDO = `Si la cuenta existe y tiene un correo, enviamos un código de ${LARGO_CODIGO} dígitos. Vence en ${MINUTOS_VIGENCIA} minutos.`;
const MENSAJE_CODIGO_INVALIDO = 'El código no es válido o venció. Pedí uno nuevo.';

const crearCodigo = () => String(crypto.randomInt(0, 10 ** LARGO_CODIGO)).padStart(LARGO_CODIGO, '0');

const formatoDeCodigo = (codigo) => typeof codigo === 'string' && new RegExp(`^\\d{${LARGO_CODIGO}}$`).test(codigo.trim());

// La huella depende de la cuenta y del secreto del servidor: el mismo código en otra cuenta da otra huella
const huellaDeCodigo = (usuarioId, codigo, secreto) => crypto.createHmac('sha256', `${secreto}:recuperacion`).update(`${usuarioId}:${String(codigo).trim()}`).digest('hex');

const huellasIguales = (a, b) => {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// Estado de un código guardado: 'vigente', 'vencido', 'agotado' (demasiados intentos) o 'usado'.
// `vencido` lo calcula la base con su propio reloj (los timestamps no llevan zona horaria: compararlos en Node daría
// corrido el tiempo si el servidor y la base no están en la misma zona).
const estadoDeCodigo = ({ vencido, intentos, usado }) => {
    if (usado) return 'usado';
    if (vencido) return 'vencido';
    if (intentos >= MAX_INTENTOS) return 'agotado';
    return 'vigente';
};

// ¿Hay que esperar antes de enviar otro código? Recibe los segundos que pasaron desde el último pedido.
const debeEsperar = (segundosDesdeElUltimo) => segundosDesdeElUltimo < ESPERA_SEGUNDOS;

const armarCorreoCodigo = ({ nombre, codigo }) => {
    const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
    const texto = `${saludo}\n\nTu código para restablecer la contraseña es: ${codigo}\n\nVence en ${MINUTOS_VIGENCIA} minutos. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.\n\nEducar para Transformar`;
    const html = `<p>${escapar(saludo)}</p><p>Tu código para restablecer la contraseña es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${escapar(codigo)}</p><p>Vence en ${MINUTOS_VIGENCIA} minutos. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.</p><p>Educar para Transformar</p>`;
    return { asunto: 'Tu código para restablecer la contraseña', texto, html };
};

module.exports = {
    MINUTOS_VIGENCIA, MAX_INTENTOS, ESPERA_SEGUNDOS, LARGO_CODIGO, MENSAJE_PEDIDO, MENSAJE_CODIGO_INVALIDO,
    crearCodigo, formatoDeCodigo, huellaDeCodigo, huellasIguales, estadoDeCodigo, debeEsperar, armarCorreoCodigo,
};
