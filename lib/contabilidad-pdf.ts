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
