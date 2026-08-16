// Exportación a Excel de gastos filtrados — 100% cliente, import dinámico de
// `xlsx` para no engordar el bundle principal (mismo criterio que las
// descargas de PDF en lib/contabilidad-pdf.ts, que también corren en el navegador).

type PagoLinea = { metodo: string; valor: number };
export type GastoExport = {
  id: number; categoria: string; proveedor?: string; nit_proveedor?: string;
  numero_factura?: string; fecha: string; descripcion?: string;
  subtotal?: number; iva?: number; total: number;
  pagos?: PagoLinea[]; abonado?: number; recurrente?: number | boolean;
  comprobante_url?: string; comprobante_pago_url?: string; notas?: string;
  estado?: string; anulado_en?: string; motivo_anulacion?: string; created_at?: string;
};

const CAT_LABEL: Record<string, string> = {
  fijo: 'Fijo', variable: 'Variable', servicio: 'Servicios', producto: 'Productos', otro: 'Otro',
};

function fmtPagos(pagos?: PagoLinea[]) {
  if (!pagos || pagos.length === 0) return '';
  return pagos.map(p => `${p.metodo || '—'}: ${Math.round(p.valor).toLocaleString('es-CO')}`).join(' + ');
}

export async function descargarGastosExcel(gastos: GastoExport[], filtrosLabel: string) {
  const { utils, writeFile } = await import('xlsx');

  const cabeceras = [
    'ID', 'Fecha', 'Categoría', 'Proveedor', 'NIT/Documento', 'N° factura', 'Descripción',
    'Subtotal', 'IVA', 'Total', 'Abonado', 'Saldo pendiente', 'Medios de pago',
    'Estado', 'Recurrente', 'Notas', 'URL factura/soporte', 'URL comprobante de pago',
  ];

  const filas = gastos.map(g => {
    const abonado = g.abonado || 0;
    const saldo = Math.max(0, (g.total || 0) - abonado);
    return [
      g.id,
      (g.fecha || '').slice(0, 10),
      CAT_LABEL[g.categoria] || g.categoria,
      g.proveedor || '',
      g.nit_proveedor || '',
      g.numero_factura || '',
      g.descripcion || '',
      g.subtotal || 0,
      g.iva || 0,
      g.total || 0,
      abonado,
      saldo,
      fmtPagos(g.pagos),
      g.estado === 'anulado' ? 'Anulado' : 'Activo',
      g.recurrente ? 'Sí' : 'No',
      g.notas || '',
      g.comprobante_url || '',
      g.comprobante_pago_url || '',
    ];
  });

  const totales = ['', '', '', '', '', '', 'TOTAL',
    filas.reduce((s, f) => s + (Number(f[7]) || 0), 0),
    filas.reduce((s, f) => s + (Number(f[8]) || 0), 0),
    filas.reduce((s, f) => s + (Number(f[9]) || 0), 0),
    filas.reduce((s, f) => s + (Number(f[10]) || 0), 0),
    filas.reduce((s, f) => s + (Number(f[11]) || 0), 0),
    '', '', '', '', '', ''];

  const wsGastos = utils.aoa_to_sheet([
    [`Gastos — ${filtrosLabel}`],
    [`Generado: ${new Date().toLocaleString('es-CO')} · ${gastos.length} gasto(s)`],
    [],
    cabeceras,
    ...filas,
    [],
    totales,
  ]);
  wsGastos['!cols'] = [
    { wch: 6 }, { wch: 11 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 26 },
    { wch: 9 }, { wch: 10 }, { wch: 24 }, { wch: 30 }, { wch: 30 },
  ];

  // Resumen por categoría — misma agregación que se ve en el panel.
  const porCategoria = new Map<string, { n: number; total: number }>();
  for (const g of gastos) {
    const key = CAT_LABEL[g.categoria] || g.categoria || 'Otro';
    const prev = porCategoria.get(key) || { n: 0, total: 0 };
    porCategoria.set(key, { n: prev.n + 1, total: prev.total + (g.total || 0) });
  }
  const wsCategorias = utils.aoa_to_sheet([
    ['Categoría', 'N° de gastos', 'Total'],
    ...Array.from(porCategoria.entries()).map(([cat, v]) => [cat, v.n, v.total]),
    ['TOTAL', gastos.length, gastos.reduce((s, g) => s + (g.total || 0), 0)],
  ]);
  wsCategorias['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }];

  const wb = utils.book_new();
  utils.book_append_sheet(wb, wsGastos, 'Gastos');
  utils.book_append_sheet(wb, wsCategorias, 'Por categoría');

  const nombreArchivo = `gastos_${new Date().toISOString().slice(0, 10)}.xlsx`;
  writeFile(wb, nombreArchivo);
}
