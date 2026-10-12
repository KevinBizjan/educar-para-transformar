// Subsistema de PDF del comprobante de pago. Solo sabe DIBUJAR el documento a partir de
// los datos del pago; no consulta la base ni conoce HTTP (eso lo coordina PagosFacade).
const PDFDocument = require('pdfkit');

const AZUL = '#1e40af';
const VERDE = '#166534';
const GRIS = '#64748b';
const formato = (n) => '$' + Number(n || 0).toFixed(2);

// Escribe el PDF del comprobante en `salida` (cualquier stream de escritura, p. ej. res).
function dibujarComprobante(pago, salida) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(salida);

    const fecha = pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleString('es-AR') : '-';

    // Encabezado institucional
    doc.fillColor(AZUL).fontSize(22).font('Helvetica-Bold').text('Educar para Transformar', { align: 'center' });
    doc.fillColor(GRIS).fontSize(10).font('Helvetica').text('C. French 414, Resistencia, Chaco · info@educartransformar.edu.ar', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(1);

    // Título
    doc.fillColor(AZUL).fontSize(16).font('Helvetica-Bold').text('COMPROBANTE DE PAGO', { align: 'center' });
    doc.fillColor(GRIS).fontSize(11).font('Helvetica').text(`Comprobante N° ${String(pago.id).padStart(6, '0')}`, { align: 'center' });
    doc.moveDown(1.5);

    // Detalle en filas
    const fila = (label, valor) => {
        doc.fillColor(GRIS).fontSize(11).font('Helvetica-Bold').text(label, 60, doc.y, { continued: true, width: 200 });
        doc.fillColor('#0f172a').font('Helvetica').text('  ' + valor);
        doc.moveDown(0.4);
    };

    fila('Fecha de pago:', fecha);
    fila('Alumno:', `${pago.alumno_apellido || ''}, ${pago.alumno_nombre || ''}`);
    fila('DNI:', pago.alumno_dni || '-');
    fila('Nivel / División:', pago.nivel_nombre ? `${pago.nivel_nombre} ${pago.division || ''}` : 'Sin asignar');
    if (pago.cuota_mes) fila('Cuota:', `${pago.cuota_mes}/${pago.cuota_anio}`);
    fila('Método de pago:', pago.metodo_pago || '-');

    doc.moveDown(0.6);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.8);

    // Monto destacado
    doc.fillColor(VERDE).fontSize(14).font('Helvetica-Bold').text(`Monto abonado: ${formato(pago.monto_pagado)}`, { align: 'right' });
    doc.moveDown(0.3);
    const saldo = Number(pago.saldo_pendiente || 0);
    doc.fillColor(saldo > 0 ? '#991b1b' : VERDE).fontSize(11).font('Helvetica')
        .text(saldo > 0 ? `Saldo pendiente actual: ${formato(saldo)}` : 'Cuenta al día ✓', { align: 'right' });

    doc.moveDown(3);
    doc.fillColor(GRIS).fontSize(9).font('Helvetica').text(
        'Este comprobante es válido como constancia de pago. Generado automáticamente por el sistema institucional.',
        { align: 'center' }
    );

    doc.end();
}

module.exports = { dibujarComprobante };
