// Reglas puras de los correos automáticos (HU10): qué día toca cada envío y cómo se arma cada mensaje.
// Sin base de datos ni red, para poder probarlas con Node.
const { esFecha, totalFactura } = require('./facturas');
const { pesos } = require('../services/facturasPdf');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TIPOS = ['factura_fin_de_mes', 'aviso_deuda'];
const DIA_AVISO = 20;
const DIAS_DE_GRACIA_AVISO = 2; // si el disparador falla el día 20, se envía el 21 o el 22 (no más tarde)

const dos = (n) => String(n).padStart(2, '0');
const fecha = (anio, mes, dia) => `${anio}-${dos(mes)}-${dos(dia)}`;
const mayuscula = (texto) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;

// "AAAA-MM-DD,AAAA-MM-DD" -> Set de feriados válidos (los inválidos se ignoran)
const feriadosDe = (texto) => new Set(String(texto || '').split(',').map((f) => f.trim()).filter(esFecha));

// Último día hábil del mes: el último de lunes a viernes que no sea feriado.
const ultimoDiaHabil = (anio, mes, feriados = new Set()) => {
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    for (let dia = ultimo; dia >= 1; dia--) {
        const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
        const texto = fecha(anio, mes, dia);
        if (semana !== 0 && semana !== 6 && !feriados.has(texto)) return texto;
    }
    return fecha(anio, mes, ultimo);
};

const periodoDe = (hoy) => hoy.slice(0, 7); // "2026-11"

// Qué envíos corresponden hoy (AAAA-MM-DD, en hora de Argentina):
//  - La factura de fin de mes, desde el último día hábil y hasta que termine el mes.
//  - El aviso de deuda, el día 20 (y hasta dos días después, por si ese día no corrió el disparador).
// Los envíos se registran por período y no se repiten, así que correrlos varios días seguidos no duplica nada.
const tareasDelDia = (hoy, feriados = new Set()) => {
    const [anio, mes, dia] = hoy.split('-').map(Number);
    const tareas = [];
    if (hoy >= ultimoDiaHabil(anio, mes, feriados)) tareas.push('factura_fin_de_mes');
    if (dia >= DIA_AVISO && dia <= DIA_AVISO + DIAS_DE_GRACIA_AVISO) tareas.push('aviso_deuda');
    return tareas;
};

// Las cuentas de las familias usan su correo como nombre de usuario (así se registran); las demás no tienen correo.
const esCorreo = (texto) => typeof texto === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim());

const escapar = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const periodoTexto = (hoy) => { const [anio, mes] = hoy.split('-').map(Number); return `${mayuscula(MESES[mes - 1])} ${anio}`; };
const fechaCorta = (texto) => (texto ? texto.split('-').reverse().join('/') : '');

const estilos = {
    cuerpo: 'font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:16px;',
    titulo: 'color:#1a5fa8;font-size:20px;margin:0 0 12px;',
    tabla: 'width:100%;border-collapse:collapse;margin:12px 0;',
    celda: 'padding:8px 6px;border-bottom:1px solid #e2e8f0;font-size:14px;',
    derecha: 'text-align:right;white-space:nowrap;',
    nota: 'background:#f1f5f9;border-radius:8px;padding:12px;font-size:13px;color:#334155;margin:14px 0;',
    pie: 'font-size:12px;color:#64748b;margin-top:20px;',
};

const filasHtml = (items) => items.map((i) => (
    `<tr><td style="${estilos.celda}">${escapar(i.descripcion)}</td><td style="${estilos.celda}${estilos.derecha}">${pesos(i.monto)}</td></tr>`
)).join('');

const envoltorio = (titulo, contenido) => (
    `<div style="${estilos.cuerpo}"><h1 style="${estilos.titulo}">${escapar(titulo)}</h1>${contenido}` +
    `<p style="${estilos.pie}">Educar para Transformar · C. French 414, Resistencia, Chaco. Este mensaje se envió automáticamente: no hace falta que respondas.</p></div>`
);

const lineasBancarias = (datos) => {
    if (!datos) return ['Consultá los datos bancarios en la institución.'];
    return [['Titular', datos.titular], ['Banco', datos.banco], ['CBU', datos.cbu], ['Alias', datos.alias]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
};

// Correo de la factura de fin de mes (se adjunta el PDF). `factura` = { referencia, total, items: [{ descripcion, monto }] }
const armarCorreoFactura = ({ nombre, factura, datosBancarios, hoy }) => {
    const periodo = periodoTexto(hoy);
    const asunto = `Factura de ${periodo} · ${factura.referencia}`;
    const bancarias = lineasBancarias(datosBancarios);
    const html = envoltorio(`Factura de ${periodo}`, [
        `<p>Hola ${escapar(nombre)}, te enviamos la factura del mes con lo que está pendiente de pago. La encontrás adjunta en PDF.</p>`,
        `<table style="${estilos.tabla}">${filasHtml(factura.items)}<tr><td style="${estilos.celda}font-weight:bold;">Total a transferir</td><td style="${estilos.celda}${estilos.derecha}font-weight:bold;">${pesos(factura.total)}</td></tr></table>`,
        `<p><strong>Referencia de pago:</strong> ${escapar(factura.referencia)}</p>`,
        `<div style="${estilos.nota}"><strong>Cómo pagar</strong><br>Transferí el total por transferencia bancaria e indicá la referencia.<br>${bancarias.map(escapar).join('<br>')}<br>Después subí el comprobante desde la app (Pagar → Mis facturas). No se aceptan pagos en efectivo.</div>`,
    ].join(''));
    const texto = [
        `Hola ${nombre},`, '', `Factura de ${periodo}. La encontrás adjunta en PDF.`, '',
        ...factura.items.map((i) => `- ${i.descripcion}: ${pesos(i.monto)}`), '', `Total a transferir: ${pesos(factura.total)}`, `Referencia de pago: ${factura.referencia}`, '',
        'Cómo pagar: transferencia bancaria indicando la referencia.', ...bancarias, 'Después subí el comprobante desde la app (Pagar → Mis facturas). No se aceptan pagos en efectivo.',
    ].join('\n');
    return { asunto, html, texto };
};

// Aviso del día 20 a quien tiene pagos pendientes o incompletos. `items` = [{ descripcion, monto, estado, vencimiento, en_factura }]
const armarAvisoDeuda = ({ nombre, items, hoy }) => {
    const periodo = periodoTexto(hoy);
    const total = totalFactura(items);
    const asunto = `Aviso de pagos pendientes · ${periodo}`;
    const detalle = (i) => `${i.descripcion}${i.estado === 'Vencida' ? ` (venció el ${fechaCorta(i.vencimiento)})` : (i.vencimiento ? ` (vence el ${fechaCorta(i.vencimiento)})` : '')}${i.en_factura ? ` · factura ${i.en_factura}` : ''}`;
    const html = envoltorio('Tenés pagos pendientes', [
        `<p>Hola ${escapar(nombre)}, al día de hoy figuran estos pagos pendientes o incompletos:</p>`,
        `<table style="${estilos.tabla}">${items.map((i) => `<tr><td style="${estilos.celda}">${escapar(detalle(i))}</td><td style="${estilos.celda}${estilos.derecha}">${pesos(i.monto)}</td></tr>`).join('')}` +
        `<tr><td style="${estilos.celda}font-weight:bold;">Total pendiente</td><td style="${estilos.celda}${estilos.derecha}font-weight:bold;">${pesos(total)}</td></tr></table>`,
        `<div style="${estilos.nota}">Podés pagar desde la app (Pagar): elegís lo que querés abonar, generás la factura y transferís. Si ya pagaste y estás esperando la confirmación, no tenés que hacer nada más.</div>`,
    ].join(''));
    const texto = [
        `Hola ${nombre},`, '', 'Al día de hoy figuran estos pagos pendientes o incompletos:', '', ...items.map((i) => `- ${detalle(i)}: ${pesos(i.monto)}`), '',
        `Total pendiente: ${pesos(total)}`, '', 'Podés pagar desde la app (Pagar). Si ya pagaste y estás esperando la confirmación, no tenés que hacer nada más.',
    ].join('\n');
    return { asunto, html, texto, total };
};

module.exports = { TIPOS, DIA_AVISO, feriadosDe, ultimoDiaHabil, periodoDe, tareasDelDia, esCorreo, escapar, armarCorreoFactura, armarAvisoDeuda, periodoTexto };
