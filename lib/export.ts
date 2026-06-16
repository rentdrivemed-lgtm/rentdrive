type Reserva = {
  id: number;
  marca: string; modelo: string; anio: number; tipo: string;
  fecha_inicio: string; fecha_fin: string;
  total: number; estado: string; pago_estado: string;
  usuario_nombre: string; propietario_nombre: string;
};

function diasEntre(a: string, b: string) {
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function fmtCOP(n: number) {
  return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

function filas(reservas: Reserva[], rol: string) {
  return reservas.map(r => {
    const base = [
      `#${r.id}`,
      `${r.marca} ${r.modelo} ${r.anio}`,
      r.tipo,
      r.fecha_inicio,
      r.fecha_fin,
      String(diasEntre(r.fecha_inicio, r.fecha_fin)),
      fmtCOP(r.total),
      r.estado,
      r.pago_estado,
    ];
    if (rol !== 'usuario') base.splice(2, 0, r.usuario_nombre);
    if (rol === 'admin')   base.splice(3, 0, r.propietario_nombre);
    return base;
  });
}

function cabeceras(rol: string) {
  const cols = ['#', 'Vehículo', 'Tipo', 'Inicio', 'Fin', 'Días', 'Total', 'Estado', 'Pago'];
  if (rol !== 'usuario') cols.splice(2, 0, 'Cliente');
  if (rol === 'admin')   cols.splice(3, 0, 'Propietario');
  return cols;
}

// ─── Excel ───────────────────────────────────────────────────────────────────
export async function exportarExcel(reservas: Reserva[], rol: string, filtrosLabel: string) {
  const { utils, writeFile } = await import('xlsx');

  const ws = utils.aoa_to_sheet([
    ['RentDrive Medellín — Historial de reservas'],
    [filtrosLabel],
    [],
    cabeceras(rol),
    ...filas(reservas, rol),
  ]);

  // Ancho automático de columnas
  ws['!cols'] = cabeceras(rol).map((_, i) => {
    const max = [cabeceras(rol)[i], ...filas(reservas, rol).map(f => f[i] ?? '')]
      .reduce((m, v) => Math.max(m, String(v).length), 0);
    return { wch: Math.min(max + 2, 40) };
  });

  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Historial');
  writeFile(wb, `rentdrive_historial_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
export async function exportarPDF(reservas: Reserva[], rol: string, filtrosLabel: string, stats: { total: number; ingresos: number; confirmadas: number; completadas: number; canceladas: number }) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape' });

  // Encabezado
  doc.setFontSize(16);
  doc.setTextColor(29, 78, 216); // blue-700
  doc.text('RentDrive Medellín', 14, 16);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Historial de reservas', 14, 22);
  doc.text(filtrosLabel, 14, 28);
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, 34);

  // Resumen estadístico
  doc.setFontSize(9);
  doc.setTextColor(50);
  const resumen = [
    `Total: ${stats.total}`,
    `Confirmadas: ${stats.confirmadas}`,
    `Completadas: ${stats.completadas}`,
    `Canceladas: ${stats.canceladas}`,
    `Ingresos: ${fmtCOP(stats.ingresos)}`,
  ].join('    ');
  doc.text(resumen, 14, 40);

  // Tabla
  autoTable(doc, {
    head: [cabeceras(rol)],
    body: filas(reservas, rol),
    startY: 46,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    didParseCell(data) {
      if (data.section === 'body') {
        const val = String(data.cell.raw ?? '');
        if (val === 'cancelada' || val === 'cancelado') {
          data.cell.styles.textColor = [220, 38, 38];
        } else if (val === 'completada' || val === 'pagado') {
          data.cell.styles.textColor = [5, 150, 105];
        } else if (val === 'confirmada') {
          data.cell.styles.textColor = [29, 78, 216];
        }
      }
    },
  });

  doc.save(`rentdrive_historial_${new Date().toISOString().slice(0, 10)}.pdf`);
}
