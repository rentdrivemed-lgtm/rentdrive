// Generación de PDF en el navegador (cotizaciones y facturas) — jsPDF + autotable.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type Empresa = { nombre: string; nit: string };
type Item = { descripcion: string; cantidad: number; valorUnitario: number };

function cop(n: number) { return `$${Math.round(n).toLocaleString('es-CO')}`; }

function documentoBase(tipo: string, numero: string, fecha: string, empresa: Empresa, cliente: { nombre: string; documento?: string; correo?: string }, items: Item[], total: number, notaFinal?: string) {
  const doc = new jsPDF();

  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(empresa.nombre || 'DrivePass', 14, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (empresa.nit) doc.text(`NIT: ${empresa.nit}`, 14, 26);

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(tipo, 196, 20, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`No. ${numero}`, 196, 26, { align: 'right' });
  doc.text(`Fecha: ${fecha}`, 196, 31, { align: 'right' });

  doc.setDrawColor(200); doc.line(14, 36, 196, 36);

  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Cliente', 14, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(cliente.nombre || '—', 14, 50);
  if (cliente.documento) doc.text(`Documento: ${cliente.documento}`, 14, 55);
  if (cliente.correo) doc.text(`Correo: ${cliente.correo}`, 14, 60);

  autoTable(doc, {
    startY: 68,
    head: [['Descripción', 'Cant.', 'Valor unitario', 'Subtotal']],
    body: items.map(it => [it.descripcion, String(it.cantidad), cop(it.valorUnitario), cop(it.cantidad * it.valorUnitario)]),
    foot: [['', '', 'Total', cop(total)]],
    theme: 'grid',
    headStyles: { fillColor: [199, 74, 33] },
    footStyles: { fillColor: [27, 51, 86], textColor: 255, fontStyle: 'bold' },
  });

  if (notaFinal) {
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 100;
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(notaFinal, 14, finalY + 10, { maxWidth: 182 });
  }

  return doc;
}

export function descargarCotizacionPDF(empresa: Empresa, cot: {
  numero: string; created_at: string; cliente_nombre: string; cliente_correo?: string;
  vehiculo_descripcion: string; dias: number; precio_dia: number; recargo: number; total: number;
}) {
  const items: Item[] = [{ descripcion: `Alquiler ${cot.vehiculo_descripcion} (${cot.dias} día${cot.dias !== 1 ? 's' : ''})`, cantidad: 1, valorUnitario: cot.total - cot.recargo }];
  if (cot.recargo > 0) items.push({ descripcion: 'Recargo por lugar de entrega/recogida', cantidad: 1, valorUnitario: cot.recargo });

  const doc = documentoBase('COTIZACIÓN', cot.numero, cot.created_at.slice(0, 10), empresa,
    { nombre: cot.cliente_nombre, correo: cot.cliente_correo }, items, cot.total,
    'Esta cotización no tiene validez tributaria — es una referencia del valor del alquiler.');
  doc.save(`${cot.numero}.pdf`);
}

export function descargarFacturaPDF(empresa: Empresa, fac: {
  numero: string; created_at: string; estado: string; cliente_nombre: string; cliente_documento?: string; cliente_correo?: string;
  subtotal: number; total: number; marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string;
  dataico_cufe?: string;
}) {
  const items: Item[] = [{ descripcion: `Alquiler ${fac.marca} ${fac.modelo} ${fac.anio} (${fac.fecha_inicio} a ${fac.fecha_fin})`, cantidad: 1, valorUnitario: fac.total }];
  const nota = fac.estado === 'emitida' && fac.dataico_cufe
    ? `CUFE: ${fac.dataico_cufe}`
    : fac.estado === 'borrador'
      ? 'BORRADOR — todavía sin validez DIAN. Se emitirá oficialmente cuando esté configurada la facturación electrónica.'
      : undefined;

  const doc = documentoBase(fac.estado === 'emitida' ? 'FACTURA ELECTRÓNICA' : 'FACTURA (BORRADOR)', fac.numero, fac.created_at.slice(0, 10), empresa,
    { nombre: fac.cliente_nombre, documento: fac.cliente_documento, correo: fac.cliente_correo }, items, fac.total, nota);
  doc.save(`${fac.numero || 'factura'}.pdf`);
}

export function descargarGastoPDF(empresa: Empresa, g: {
  id: number; categoria: string; proveedor?: string; nit_proveedor?: string; numero_factura?: string;
  fecha: string; descripcion?: string; subtotal?: number; iva?: number; total: number;
  pagos?: Array<{ metodo: string; valor: number }>; abonado?: number; notas?: string; estado?: string;
}) {
  const doc = new jsPDF();
  const numero = `GTO-${String(g.id).padStart(6, '0')}`;

  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(empresa.nombre || 'DrivePass', 14, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (empresa.nit) doc.text(`NIT: ${empresa.nit}`, 14, 26);

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE GASTO', 196, 20, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`No. ${numero}`, 196, 26, { align: 'right' });
  doc.text(`Fecha: ${(g.fecha || '').slice(0, 10)}`, 196, 31, { align: 'right' });
  if (g.estado === 'anulado') {
    doc.setTextColor(199, 74, 33); doc.setFont('helvetica', 'bold');
    doc.text('ANULADO', 196, 36, { align: 'right' });
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
  }

  doc.setDrawColor(200); doc.line(14, 40, 196, 40);

  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Proveedor', 14, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(g.proveedor || '—', 14, 54);
  if (g.nit_proveedor) doc.text(`NIT/Doc: ${g.nit_proveedor}`, 14, 59);
  if (g.numero_factura) doc.text(`Factura/recibo: ${g.numero_factura}`, 14, 64);

  doc.setFont('helvetica', 'bold');
  doc.text('Detalle', 120, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(`Categoría: ${g.categoria}`, 120, 54);
  if (g.descripcion) doc.text(doc.splitTextToSize(g.descripcion, 76) as string[], 120, 59);

  const abonado = g.abonado ?? (g.pagos || []).reduce((s, p) => s + p.valor, 0);
  const saldo = g.total - abonado;

  const body: string[][] = [];
  if (g.subtotal) body.push(['Subtotal (base)', cop(g.subtotal)]);
  if (g.iva) body.push(['IVA / impuestos', cop(g.iva)]);
  body.push(['Total del gasto', cop(g.total)]);

  autoTable(doc, {
    startY: 74,
    head: [['Concepto', 'Valor']],
    body,
    theme: 'grid',
    headStyles: { fillColor: [199, 74, 33] },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 100;

  if (g.pagos && g.pagos.length > 0) {
    autoTable(doc, {
      startY: y + 6,
      head: [['Medio de pago (abono)', 'Valor']],
      body: g.pagos.map(p => [p.metodo || '—', cop(p.valor)]),
      foot: [['Abonado', cop(abonado)], ['Saldo pendiente', cop(saldo)]],
      theme: 'grid',
      headStyles: { fillColor: [27, 51, 86] },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || y + 30;
  } else {
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(`Saldo pendiente: ${cop(saldo)}`, 14, y + 10);
    doc.setFont('helvetica', 'normal');
    y += 10;
  }

  if (g.notas) {
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Notas: ${g.notas}`, 14, y + 10, { maxWidth: 182 });
  }

  doc.save(`${numero}.pdf`);
}

export function descargarRemisionPDF(empresa: Empresa, rem: {
  numero: string; created_at?: string; propietario_nombre: string; propietario_documento?: string;
  vehiculo_descripcion: string; placa?: string; fecha_inicio: string; fecha_fin: string; dias: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
}) {
  const doc = new jsPDF();

  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(empresa.nombre || 'DrivePass', 14, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (empresa.nit) doc.text(`NIT: ${empresa.nit}`, 14, 26);

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('REMISIÓN', 196, 20, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`No. ${rem.numero}`, 196, 26, { align: 'right' });
  doc.text(`Fecha: ${(rem.created_at || '').slice(0, 10)}`, 196, 31, { align: 'right' });

  doc.setDrawColor(200); doc.line(14, 36, 196, 36);

  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Propietario del vehículo', 14, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(rem.propietario_nombre || '—', 14, 50);
  if (rem.propietario_documento) doc.text(`Documento: ${rem.propietario_documento}`, 14, 55);

  doc.setFont('helvetica', 'bold');
  doc.text('Vehículo', 120, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(rem.vehiculo_descripcion || '—', 120, 50);
  if (rem.placa) doc.text(`Placa: ${rem.placa}`, 120, 55);
  doc.text(`Período: ${rem.fecha_inicio} a ${rem.fecha_fin}`, 120, 60);

  autoTable(doc, {
    startY: 70,
    head: [['Concepto', 'Valor']],
    body: [
      [`Alquiler ${rem.vehiculo_descripcion} (${rem.dias} día${rem.dias !== 1 ? 's' : ''})`, cop(rem.bruto)],
      [`Comisión ${empresa.nombre || 'DrivePass'} (${(rem.comision_pct * 100).toFixed(0)}%)`, `- ${cop(rem.comision_valor)}`],
    ],
    foot: [['Neto a pagar al propietario', cop(rem.neto)]],
    theme: 'grid',
    headStyles: { fillColor: [199, 74, 33] },
    footStyles: { fillColor: [27, 51, 86], textColor: 255, fontStyle: 'bold' },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 100;
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Documento de remisión interno — soporte de la liquidación al propietario. No constituye factura.', 14, finalY + 10, { maxWidth: 182 });

  doc.save(`${rem.numero || 'remision'}.pdf`);
}

// La cuenta de cobro que firma el propietario para autorizar el pago (firma electrónica
// simple, ver PROYECTO.md). Mismo desglose que la remisión, pero con el bloque de firma
// (o "PENDIENTE DE FIRMA" bien visible si todavía no se ha firmado — nunca un espacio en
// blanco que pueda confundirse con un documento válido sin firmar).
export function descargarCuentaCobroPDF(empresa: Empresa, rem: {
  numero: string; created_at?: string; propietario_nombre: string; propietario_documento?: string;
  vehiculo_descripcion: string; placa?: string; fecha_inicio: string; fecha_fin: string; dias: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  firmada_en?: string; firma_imagen?: string; firma_nombre_confirmado?: string; firma_ip?: string;
}) {
  const doc = new jsPDF();

  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(empresa.nombre || 'DrivePass', 14, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (empresa.nit) doc.text(`NIT: ${empresa.nit}`, 14, 26);

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('CUENTA DE COBRO', 196, 20, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`No. ${rem.numero}`, 196, 26, { align: 'right' });
  doc.text(`Fecha: ${(rem.created_at || '').slice(0, 10)}`, 196, 31, { align: 'right' });

  doc.setDrawColor(200); doc.line(14, 36, 196, 36);

  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Propietario del vehículo', 14, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(rem.propietario_nombre || '—', 14, 50);
  if (rem.propietario_documento) doc.text(`Documento: ${rem.propietario_documento}`, 14, 55);

  doc.setFont('helvetica', 'bold');
  doc.text('Vehículo', 120, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(rem.vehiculo_descripcion || '—', 120, 50);
  if (rem.placa) doc.text(`Placa: ${rem.placa}`, 120, 55);
  doc.text(`Período: ${rem.fecha_inicio} a ${rem.fecha_fin}`, 120, 60);

  autoTable(doc, {
    startY: 70,
    head: [['Concepto', 'Valor']],
    body: [
      [`Alquiler ${rem.vehiculo_descripcion} (${rem.dias} día${rem.dias !== 1 ? 's' : ''})`, cop(rem.bruto)],
      [`Comisión ${empresa.nombre || 'DrivePass'} (${(rem.comision_pct * 100).toFixed(0)}%)`, `- ${cop(rem.comision_valor)}`],
    ],
    foot: [['Neto a pagar al propietario', cop(rem.neto)]],
    theme: 'grid',
    headStyles: { fillColor: [199, 74, 33] },
    footStyles: { fillColor: [27, 51, 86], textColor: 255, fontStyle: 'bold' },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 100;

  if (rem.firmada_en) {
    y += 14;
    doc.setFontSize(10); doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    doc.text('Autorización del propietario', 14, y);
    y += 6;
    if (rem.firma_imagen) {
      try {
        doc.addImage(rem.firma_imagen, 'PNG', 14, y, 70, 30);
        y += 34;
      } catch {
        // Si el data URI no es válido (dato corrupto/incompleto) no tumba la generación del PDF.
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text('(No se pudo mostrar la imagen de la firma)', 14, y);
        y += 8;
      }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
    if (rem.firma_nombre_confirmado) doc.text(`Firmado por: ${rem.firma_nombre_confirmado}`, 14, y);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(
      `Firmado electrónicamente el ${rem.firmada_en.slice(0, 16).replace('T', ' ')}${rem.firma_ip ? ` desde IP ${rem.firma_ip}` : ''}.`,
      14, y + 6, { maxWidth: 182 },
    );
    y += 14;
  } else {
    y += 14;
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(199, 74, 33);
    doc.text('PENDIENTE DE FIRMA', 14, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('Esta cuenta de cobro todavía no ha sido firmada por el propietario. No autoriza ningún pago.', 14, y + 7, { maxWidth: 182 });
    y += 14;
  }

  doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Cuenta de cobro — documento de autorización de pago al propietario. No constituye factura.', 14, y + 8, { maxWidth: 182 });

  doc.save(`${rem.numero || 'cuenta-cobro'}.pdf`);
}
