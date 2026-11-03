// PDF del comprobante consolidado de una factura y del historial de deudas y pagos (HU9).
// Solo sabe DIBUJAR a partir de los datos que le llegan: no consulta la base ni conoce HTTP.
const PDFDocument = require('pdfkit');

const AZUL = '#1e40af';
const VERDE = '#166534';
const ROJO = '#991b1b';
const AMBAR = '#92400e';
const GRIS = '#64748b';
const TEXTO = '#0f172a';
const ZONA = 'America/Argentina/Buenos_Aires';
const IZQ = 50;
const DER = 545;

// "$12.345,67": punto para los miles y coma para los centavos (igual que en la app)
const pesos = (monto) => {
    const n = Number(monto) || 0;
    const [entero, decimales] = Math.abs(n).toFixed(2).split('.');
    return `${n < 0 ? '-' : ''}$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimales}`;
};
// Los timestamps de la base están en UTC; se muestran en hora de Argentina
const momento = (valor) => (valor ? new Date(valor).toLocaleString('es-AR', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' }) : '-');
const dia = (texto) => (texto ? texto.split('-').reverse().join('/') : null);
const ETIQUETA_ESTADO = { Pendiente: 'Pendiente de pago', 'En revision': 'En revisión', Pagada: 'Pagada', Rechazada: 'Rechazada' };
const COLOR_ESTADO = { Pendiente: AZUL, 'En revision': AMBAR, Pagada: VERDE, Rechazada: ROJO };

const encabezado = (doc, titulo) => {
    doc.fillColor(AZUL).fontSize(22).font('Helvetica-Bold').text('Educar para Transformar', { align: 'center' });
    doc.fillColor(GRIS).fontSize(10).font('Helvetica').text('C. French 414, Resistencia, Chaco · info@educartransformar.edu.ar', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(IZQ, doc.y).lineTo(DER, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(1);
    doc.fillColor(AZUL).fontSize(16).font('Helvetica-Bold').text(titulo, { align: 'center' });
    doc.moveDown(1);
};

const pie = (doc) => {
    doc.moveDown(2);
    doc.fillColor(GRIS).fontSize(9).font('Helvetica').text(
        'Documento generado automáticamente por el sistema institucional. El pago se realiza solo por transferencia bancaria.',
        IZQ, doc.y, { align: 'center', width: DER - IZQ }
    );
};

// Si lo que sigue no entra en la página, se pasa a una nueva
const hacerLugar = (doc, alto) => { if (doc.y + alto > doc.page.height - 70) doc.addPage(); };

const dato = (doc, etiqueta, valor, color = TEXTO) => {
    doc.fillColor(GRIS).fontSize(11).font('Helvetica-Bold').text(etiqueta, IZQ, doc.y, { continued: true });
    doc.fillColor(color).font('Helvetica').text(`  ${valor}`);
    doc.moveDown(0.3);
};

// Líneas de ítems: descripción a la izquierda y monto a la derecha
const filaItem = (doc, descripcion, monto, negrita = false) => {
    hacerLugar(doc, 20);
    const y = doc.y;
    doc.fillColor(TEXTO).fontSize(10).font(negrita ? 'Helvetica-Bold' : 'Helvetica').text(descripcion, IZQ + 10, y, { width: 350, lineBreak: true });
    const fin = doc.y;
    doc.text(pesos(monto), DER - 110, y, { width: 110, align: 'right' });
    doc.y = Math.max(fin, y + 12) + 3;
};

function pintarFactura(doc, f, { tituloItems = 'Detalle', compacto = false } = {}) {
    const color = COLOR_ESTADO[f.estado] || TEXTO;
    hacerLugar(doc, 90 + (f.items || []).length * 16);
    doc.fillColor(AZUL).fontSize(compacto ? 12 : 11).font('Helvetica-Bold').text(f.referencia, IZQ, doc.y, { continued: true });
    doc.fillColor(color).font('Helvetica-Bold').text(`   ${ETIQUETA_ESTADO[f.estado] || f.estado}`);
    doc.fillColor(GRIS).fontSize(9).font('Helvetica').text(
        `Emitida el ${momento(f.emitida_en)}${f.pagada_en ? ` · Pagada el ${momento(f.pagada_en)}` : ''}`
    );
    if (f.estado === 'Rechazada' && f.motivo_rechazo) doc.fillColor(ROJO).text(`Motivo del rechazo: ${f.motivo_rechazo}`, { width: DER - IZQ });
    doc.moveDown(0.4);
    doc.fillColor(GRIS).fontSize(9).font('Helvetica-Bold').text(tituloItems.toUpperCase(), IZQ + 10);
    doc.moveDown(0.2);
    for (const item of f.items || []) filaItem(doc, item.descripcion, item.monto);
    doc.moveDown(0.1);
    doc.moveTo(DER - 200, doc.y).lineTo(DER, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.2);
    doc.fillColor(TEXTO).fontSize(11).font('Helvetica-Bold').text(`Total: ${pesos(f.total)}`, IZQ, doc.y, { align: 'right', width: DER - IZQ });
    doc.moveDown(0.8);
}

// Comprobante consolidado de UNA factura: sus ítems desglosados, el total y su estado.
function dibujarFactura(factura, salida) {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Comprobante ${factura.referencia}` } });
    doc.pipe(salida);
    encabezado(doc, 'COMPROBANTE CONSOLIDADO');
    dato(doc, 'Referencia:', factura.referencia);
    dato(doc, 'Responsable de pago:', factura.padre || '-');
    dato(doc, 'Estado:', ETIQUETA_ESTADO[factura.estado] || factura.estado, COLOR_ESTADO[factura.estado]);
    doc.moveDown(0.6);
    doc.moveTo(IZQ, doc.y).lineTo(DER, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.8);
    pintarFactura(doc, factura, { tituloItems: 'Desglose por ítem' });
    if (factura.estado === 'Pagada') {
        doc.fillColor(VERDE).fontSize(10).font('Helvetica-Bold').text('Pago confirmado por la institución.', IZQ, doc.y, { align: 'center', width: DER - IZQ });
    }
    pie(doc);
    doc.end();
}

// Historial de deudas y pagos de una familia en un rango de fechas: facturas con su desglose, pagos registrados en la
// institución y el resumen de totales.
function dibujarHistorial({ padre, desde, hasta, facturas, otrosPagos = [], resumen }, salida) {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Historial de deudas y pagos' } });
    doc.pipe(salida);
    encabezado(doc, 'HISTORIAL DE DEUDAS Y PAGOS');
    dato(doc, 'Responsable de pago:', padre || '-');
    dato(doc, 'Período:', desde || hasta ? `${dia(desde) || 'inicio'} al ${dia(hasta) || 'hoy'}` : 'Todo el historial');
    doc.moveDown(0.4);

    doc.fillColor(AZUL).fontSize(12).font('Helvetica-Bold').text('Resumen', IZQ, doc.y);
    doc.moveDown(0.3);
    for (const [texto, valor, color] of [
        ['Facturado', resumen.total_facturado, TEXTO], ['Pagado', resumen.total_pagado, VERDE],
        ['Pendiente (incluye lo que está en revisión)', resumen.total_pendiente, resumen.total_pendiente > 0 ? ROJO : VERDE], ['Rechazado', resumen.total_rechazado, GRIS],
    ]) {
        doc.fillColor(color).fontSize(10).font('Helvetica').text(texto, IZQ + 10, doc.y, { continued: true, width: 300 });
        doc.font('Helvetica-Bold').text(pesos(valor), { align: 'right', width: DER - IZQ - 10 });
    }
    doc.moveDown(1);

    if (facturas.length === 0) {
        doc.fillColor(GRIS).fontSize(11).font('Helvetica').text('No hay facturas en este período.', IZQ, doc.y, { align: 'center', width: DER - IZQ });
    } else {
        doc.fillColor(AZUL).fontSize(12).font('Helvetica-Bold').text(`Facturas (${facturas.length})`, IZQ, doc.y);
        doc.moveDown(0.5);
        for (const f of facturas) pintarFactura(doc, f, { compacto: true });
    }

    if (otrosPagos.length > 0) {
        hacerLugar(doc, 60);
        doc.fillColor(AZUL).fontSize(12).font('Helvetica-Bold').text('Pagos registrados en la institución', IZQ, doc.y);
        doc.moveDown(0.4);
        for (const p of otrosPagos) filaItem(doc, `${momento(p.fecha_pago)} · ${p.alumno}${p.cuota_mes ? ` · Cuota ${p.cuota_mes}/${p.cuota_anio}` : ''}${p.metodo_pago ? ` · ${p.metodo_pago}` : ''}`, p.monto);
    }
    pie(doc);
    doc.end();
}

module.exports = { dibujarFactura, dibujarHistorial, pesos };
