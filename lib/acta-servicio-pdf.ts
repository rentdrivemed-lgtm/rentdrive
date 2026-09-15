// ── PDF del acta de respaldo del servicio ───────────────────────────────────
//
// Parte PESADA (jsPDF + sharp + red) de `lib/acta-servicio.ts`, separada igual que
// `lib/contabilidad-pdf.ts` lo está de `lib/contabilidad.ts`: `lib/db.ts` → `lib/
// operaciones.ts` → `lib/acta-servicio.ts` es una cadena que carga casi cualquier
// ruta de la app, y no tiene por qué arrastrar jsPDF ni sharp.
//
// El PDF se arma en el SERVIDOR, no en el navegador. Dos razones: (1) no hay problema
// de CORS al incrustar las fotos de Cloudinary, y (2) está pendiente pasar los
// documentos de Cloudinary a entrega autenticada con URLs firmadas — un PDF armado en
// el servidor sigue funcionando después de ese cambio, uno armado en el cliente se
// rompería.
//
// Se arma SIEMPRE desde el snapshot congelado (`actas_servicio`), nunca desde los datos
// de hoy: por eso `construirActaPDF` recibe un `ActaGuardada` y no un id de operación.
import { promises as fs } from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import sharp from 'sharp';
import { numeroActa, omisionesDeActa, type ActaGuardada, type FaseFoto, type FotoActa } from './acta-servicio';
import { CASILLAS, esUrlFotoSegura, nombreCasilla, ordenCasilla, type CasillaId } from './fotos-servicio';
import { descargarAcotado } from './descarga-remota';

function pesos(n: number): string {
  return `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
}

type ImagenPdf = { dataUrl: string; ancho: number; alto: number };

// 1000 px de ancho impresos en los 182 mm útiles de la hoja son ~140 dpi: de sobra
// para ver un rayón. Estaba en 1400 y cada foto entra al PDF como base64 (un tercio
// más de peso que el binario) y se queda ahí hasta que el documento se serializa, así
// que el ancho es lo que decide la memoria del proceso: 16 fotos llegaron a marcar
// +285 MB de RSS en la medición del revisor.
const ANCHO_MAX_PX = 1000;
const TIMEOUT_DESCARGA_MS = 20_000;
/** Tope de peso por foto. Una foto de servicio real no llega a 15 MB. */
const MAX_BYTES_FOTO = 15 * 1024 * 1024;
/**
 * Tope DURO de fotos incrustadas en un acta. Las que se pasen de acá se listan con
 * su dirección y una nota, igual que se hace con las que no se pudieron bajar: el
 * acta sigue diciendo qué fotos había, pero el proceso no intenta meter doscientas
 * imágenes en memoria (`MAX_FOTOS_FASE` permite hasta 200 por fase en operaciones
 * viejas, y a 20 s de timeout cada una eso es una petición colgada más de una hora).
 * Un servicio guiado normal tiene 16.
 */
const MAX_FOTOS_INCRUSTADAS = 24;

/**
 * Baja una foto y la normaliza a JPEG. Pasa por `sharp` a propósito: Cloudinary
 * puede devolver WebP (las fotos de vehículo se suben así, ver lib/estandarizar-foto.ts)
 * y jsPDF solo sabe incrustar JPEG/PNG. De paso normaliza la orientación EXIF y baja
 * el peso. Devuelve `null` si la foto no se pudo traer: una imagen caída NO puede
 * tumbar la generación del acta completa.
 *
 * ⚠️ La dirección sale del SNAPSHOT congelado, o sea de algo que alguien escribió en
 * la base hace tiempo (incluida la pantalla del mensajero, que no tiene login). Por
 * eso se vuelve a validar acá con `esUrlFotoSegura` aunque ya se validara al
 * guardar: este es el punto donde el servidor se conecta de verdad, y una URL vieja
 * o envenenada no puede convertirse en una petición a la red interna. La descarga va
 * por `descargarAcotado` (sin seguir redirecciones y con tope de bytes).
 */
async function cargarImagen(url: string): Promise<ImagenPdf | null> {
  try {
    let original: Buffer;
    if (!esUrlFotoSegura(url)) return null;
    if (url.startsWith('/')) {
      // Fotos legado guardadas en el filesystem local (public/uploads/...).
      const rel = url.split('?')[0].replace(/^\/+/, '');
      const base = path.join(process.cwd(), 'public');
      const abs = path.join(base, rel);
      if (!abs.startsWith(base + path.sep)) return null; // no salir de public/
      original = await fs.readFile(abs);
    } else {
      original = (await descargarAcotado(url, { timeoutMs: TIMEOUT_DESCARGA_MS, maxBytes: MAX_BYTES_FOTO })).buffer;
    }

    const buffer = await sharp(original)
      .rotate()
      .resize({ width: ANCHO_MAX_PX, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`, ancho: meta.width, alto: meta.height };
  } catch {
    return null;
  }
}

const MARGEN = 14;
const ANCHO_UTIL = 182;   // 210mm de A4 menos los dos márgenes
const ALTO_PAGINA = 297;
const ALTO_MAX_FOTO = 115; // mm: entran ~2 fotos grandes por página

const SEV_LABEL: Record<string, string> = {
  ninguna: 'Sin daños nuevos',
  leve: 'Daños leves',
  moderada: 'Daños moderados',
  grave: 'Daños graves',
};

// Los valores crudos de la BD ('en_proceso', 'cedula_ext'...) no se le muestran a
// nadie: el acta la lee una persona, no el sistema.
const ESTADO_OP_LABEL: Record<string, string> = {
  pendiente: 'Sin asignar',
  asignada: 'Asignada a un mensajero',
  en_proceso: 'En proceso',
  finalizada: 'Finalizada',
};

const ESTADO_PAGO_LABEL: Record<string, string> = {
  pendiente: 'Pago pendiente',
  pagado: 'Pagado',
  cancelado: 'Cancelado',
};

const TIPO_DOC_LABEL: Record<string, string> = {
  cedula: 'Cédula de ciudadanía',
  cedula_ext: 'Cédula de extranjería',
  pasaporte: 'Pasaporte',
};

function etiqueta(mapa: Record<string, string>, valor: string | undefined): string {
  if (!valor) return '—';
  return mapa[valor] || valor;
}

const FASE_LABEL: Record<FaseFoto, string> = {
  salida: 'SALIDA (entrega al cliente)',
  entrada: 'ENTRADA (devolución)',
};

// Nombre corto de la fase para el pie de cada foto, cuando el encabezado de la zona
// ya dice de qué zona se trata.
const FASE_CORTA: Record<FaseFoto, string> = { salida: 'Salida', entrada: 'Entrada' };

/** Salta de página si lo que viene no cabe en lo que queda de la actual. */
function asegurarEspacio(doc: jsPDF, y: number, alto: number): number {
  if (y + alto > ALTO_PAGINA - 18) { doc.addPage(); return 20; }
  return y;
}

function finalY(doc: jsPDF, alternativa: number): number {
  const t = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return t?.finalY ?? alternativa;
}

/**
 * Arma el PDF del acta a partir del snapshot congelado (NO de los datos de hoy).
 * `async` porque tiene que bajar e incrustar todas las fotos.
 */
export async function construirActaPDF(acta: ActaGuardada): Promise<jsPDF> {
  const d = acta.datos;
  const numero = numeroActa(acta);
  const doc = new jsPDF();

  // ── Encabezado ──
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text(d.empresa?.nombre || 'DrivePass', MARGEN, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (d.empresa?.nit) doc.text(`NIT: ${d.empresa.nit}`, MARGEN, 26);

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('ACTA DE RESPALDO DEL SERVICIO', 196, 20, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`No. ${numero}`, 196, 26, { align: 'right' });
  doc.text(`Generada: ${d.generada_en || '—'}`, 196, 31, { align: 'right' });

  doc.setDrawColor(200); doc.line(MARGEN, 36, 196, 36);

  // ── Vehículo / cliente ──
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Vehículo', MARGEN, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(`${d.vehiculo?.marca || ''} ${d.vehiculo?.modelo || ''} ${d.vehiculo?.anio || ''}`.trim() || '—', MARGEN, 50);
  doc.text(`Placa: ${d.vehiculo?.placa || 'sin registrar'}`, MARGEN, 55);

  doc.setFont('helvetica', 'bold');
  doc.text('Cliente', 110, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(d.cliente?.nombre || '—', 110, 50);
  doc.text(`Celular: ${d.cliente?.celular || '—'}`, 110, 55);
  doc.text(
    `Documento: ${d.cliente?.documento || '—'}${d.cliente?.tipo_documento ? ` (${etiqueta(TIPO_DOC_LABEL, d.cliente.tipo_documento)})` : ''}`,
    110, 60,
  );

  // ── Datos del servicio ──
  autoTable(doc, {
    startY: 68,
    head: [['Dato del servicio', 'Valor']],
    body: [
      ['Número de reserva', `#${d.reserva?.id ?? '—'}`],
      ['Número de operación (servicio)', `#${d.operacion?.id ?? acta.operacion_id}`],
      ['Entrega al cliente', `${d.reserva?.fecha_inicio || '—'} · ${d.reserva?.entrega_lugar || '—'}`],
      ['Devolución', `${d.reserva?.fecha_fin || '—'} · ${d.reserva?.devolucion_lugar || '—'}`],
      ['Recargo por lugar', pesos(d.reserva?.recargo || 0)],
      ['Total de la reserva', pesos(d.reserva?.total || 0)],
      ['Estado del pago', etiqueta(ESTADO_PAGO_LABEL, d.reserva?.pago_estado)],
      ['Estado del servicio', etiqueta(ESTADO_OP_LABEL, d.operacion?.estado)],
      ['Mensajero que atendió', d.atendio?.mensajero_nombre
        ? `${d.atendio.mensajero_nombre}${d.atendio.mensajero_celular ? ` · ${d.atendio.mensajero_celular}` : ''}`
        : 'Sin mensajero asignado'],
      ['Acta generada por', d.generada_por_nombre || (d.generada_por === 'sistema' ? 'Cierre automático del servicio' : '—')],
    ],
    theme: 'grid',
    headStyles: { fillColor: [199, 74, 33] },
    styles: { fontSize: 9 },
    columnStyles: { 0: { cellWidth: 60 } },
    margin: { left: MARGEN, right: MARGEN },
  });

  let y = finalY(doc, 160);

  if (d.operacion?.notas) {
    y = asegurarEspacio(doc, y, 25);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
    doc.text('Notas internas del servicio', MARGEN, y + 8);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(d.operacion.notas, ANCHO_UTIL) as string[], MARGEN, y + 13);
    y += 13 + Math.min(40, (doc.splitTextToSize(d.operacion.notas, ANCHO_UTIL) as string[]).length * 4.5);
  }

  // ── Inspección con IA ──
  doc.setTextColor(0);
  const insp = d.inspeccion?.resultado;
  if (insp) {
    autoTable(doc, {
      startY: y + 8,
      head: [['Inspección de daños con apoyo de IA', '']],
      body: [
        ['Resultado', SEV_LABEL[insp.severidad_general] || insp.severidad_general || '—'],
        ['¿Daños nuevos?', insp.hay_danos_nuevos ? 'Sí' : 'No'],
        ['Resumen', insp.resumen || '—'],
        ['Zonas que no se pudieron comparar', insp.zonas_no_comparables || 'Ninguna'],
        ['Recomendación', insp.recomendacion || '—'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [27, 51, 86] },
      styles: { fontSize: 9, cellWidth: 'wrap' },
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: ANCHO_UTIL - 60 } },
      margin: { left: MARGEN, right: MARGEN },
    });
    y = finalY(doc, y + 40);

    const hallazgos = Array.isArray(insp.hallazgos) ? insp.hallazgos : [];
    if (hallazgos.length > 0) {
      autoTable(doc, {
        startY: y + 4,
        head: [['Hallazgo', 'Ubicación', 'Descripción', 'Confianza']],
        body: hallazgos.map(h => [
          String(h.tipo || '').replace(/_/g, ' '),
          h.ubicacion || '—',
          h.descripcion || '—',
          h.confianza || '—',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [27, 51, 86] },
        styles: { fontSize: 8 },
        margin: { left: MARGEN, right: MARGEN },
      });
      y = finalY(doc, y + 30);
    }

    y = asegurarEspacio(doc, y, 16);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(
      'El resultado de la inteligencia artificial es un APOYO. La decisión final sobre el estado del vehículo la tomó una persona del equipo.',
      MARGEN, y + 6, { maxWidth: ANCHO_UTIL },
    );
    y += 12;
  } else {
    y = asegurarEspacio(doc, y, 26);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text('Inspección de daños con IA', MARGEN, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(
      'Este servicio NO tiene inspección con IA registrada. El respaldo contiene únicamente las fotos y los datos del servicio.',
      MARGEN, y + 16, { maxWidth: ANCHO_UTIL },
    );
    y += 22;
  }

  // ── Fotos ──
  //
  // Van AGRUPADAS POR ZONA (las casillas de lib/fotos-servicio.ts), no por fase: la
  // foto de la esquina trasera derecha en la entrega y la de esa misma esquina en la
  // devolución quedan una debajo de la otra, que es exactamente lo que alguien
  // necesita para decidir si un rayón es nuevo. Agrupadas por fase había que pasar
  // ocho páginas hacia adelante y hacia atrás comparando de memoria.
  //
  // Las fotos sin zona (operaciones anteriores a las casillas, o fotos sueltas) van
  // después, agrupadas por fase como se imprimían antes: un acta vieja se sigue
  // viendo igual que siempre.
  const fotos = acta.fotos;
  const omisiones = omisionesDeActa(d);
  doc.addPage();
  y = 20;
  doc.setTextColor(0); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text('Fotos del servicio', MARGEN, y);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
  doc.text(
    `Estas son las ${fotos.length} foto(s) que tenía el servicio cuando se generó este respaldo. Quitarlas después de la operación no cambia este documento.`,
    MARGEN, y + 6, { maxWidth: ANCHO_UTIL },
  );
  y += 16;

  if (fotos.length === 0) {
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text('Este servicio no tenía ninguna foto cargada al generarse el respaldo.', MARGEN, y);
    y += 8;
  }

  // Cuántas fotos se han incrustado ya: a partir de `MAX_FOTOS_INCRUSTADAS` solo se
  // listan (dirección + nota), que es exactamente lo que ya se hacía con las fotos
  // que no se podían bajar.
  let incrustadas = 0;

  /** Anota una foto que NO se incrusta (caída, rechazada o pasada del tope). */
  const anotarFoto = (foto: FotoActa, pie: string, motivo: string): void => {
    if (y > ALTO_PAGINA - 30) { doc.addPage(); y = 20; }
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 40, 40);
    doc.text(`${pie} — ${motivo}`, MARGEN, y, { maxWidth: ANCHO_UTIL });
    doc.setTextColor(120); doc.setFontSize(7);
    doc.text(foto.url, MARGEN, y + 4, { maxWidth: ANCHO_UTIL });
    y += 12;
  };

  /** Incrusta una foto con su pie. Una imagen caída no tumba el acta: se anota. */
  const ponerFoto = async (foto: FotoActa, pie: string): Promise<void> => {
    if (incrustadas >= MAX_FOTOS_INCRUSTADAS) {
      anotarFoto(foto, pie, `este respaldo ya trae las ${MAX_FOTOS_INCRUSTADAS} fotos que caben incrustadas; esta queda listada con su dirección.`);
      return;
    }
    const img = await cargarImagen(foto.url);

    if (!img) {
      anotarFoto(foto, pie, 'no se pudo incrustar esta foto en el PDF.');
      return;
    }
    incrustadas++;

    let ancho = ANCHO_UTIL;
    let alto = (img.alto / img.ancho) * ancho;
    if (alto > ALTO_MAX_FOTO) {
      alto = ALTO_MAX_FOTO;
      ancho = (img.ancho / img.alto) * alto;
    }
    if (y + alto + 10 > ALTO_PAGINA - MARGEN) { doc.addPage(); y = 20; }

    try {
      doc.addImage(img.dataUrl, 'JPEG', MARGEN, y, ancho, alto);
    } catch {
      doc.setFontSize(9); doc.setTextColor(180, 40, 40);
      doc.text(`${pie} — no se pudo incrustar esta foto en el PDF.`, MARGEN, y, { maxWidth: ANCHO_UTIL });
      y += 10;
      return;
    }
    y += alto + 4;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(pie, MARGEN, y);
    y += 8;
  };

  const encabezadoGrupo = (texto: string, altoQueViene: number): void => {
    if (y + altoQueViene > ALTO_PAGINA - 30) { doc.addPage(); y = 20; }
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(199, 74, 33);
    doc.text(texto, MARGEN, y);
    y += 6;
  };

  // ── Zona por zona (salida y entrada juntas) ──
  const conZona = (casilla: CasillaId, fase: FaseFoto): FotoActa | undefined =>
    fotos.find(f => f.casilla === casilla && f.fase === fase);

  for (const c of CASILLAS) {
    const fSalida = conZona(c.id, 'salida');
    const fEntrada = conZona(c.id, 'entrada');
    const omitidaSalida = omisiones.find(o => o.casilla === c.id && o.fase === 'salida');
    const omitidaEntrada = omisiones.find(o => o.casilla === c.id && o.fase === 'entrada');
    if (!fSalida && !fEntrada && !omitidaSalida && !omitidaEntrada) continue;

    // Reservar espacio para el encabezado + al menos una foto: un título de zona
    // solo al pie de la página, con sus fotos en la siguiente, es ilegible.
    encabezadoGrupo(`${ordenCasilla(c.id)}. ${c.nombre.toUpperCase()}`, 40);

    for (const fase of ['salida', 'entrada'] as const) {
      const foto = fase === 'salida' ? fSalida : fEntrada;
      const omitida = fase === 'salida' ? omitidaSalida : omitidaEntrada;
      if (foto) {
        await ponerFoto(foto, `${FASE_CORTA[fase]} — ${c.nombre}`);
      } else if (omitida) {
        if (y > ALTO_PAGINA - 26) { doc.addPage(); y = 20; }
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(150, 90, 20);
        doc.text(
          `${FASE_CORTA[fase]}: no se tomó. Motivo: "${omitida.motivo}" — ${omitida.autor || 'sin nombre'}${omitida.fecha ? `, ${omitida.fecha}` : ''}.`,
          MARGEN, y, { maxWidth: ANCHO_UTIL },
        );
        y += 10;
      } else {
        if (y > ALTO_PAGINA - 22) { doc.addPage(); y = 20; }
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(150);
        doc.text(`${FASE_CORTA[fase]}: sin foto de esta zona.`, MARGEN, y);
        y += 8;
      }
    }
    y += 2;
  }

  // ── Fotos sin zona asignada (formato anterior a las casillas) ──
  const sinZona = fotos.filter(f => !f.casilla);
  if (sinZona.length > 0) {
    encabezadoGrupo('FOTOS SIN ZONA ASIGNADA', 30);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
    doc.text(
      'Estas fotos se tomaron antes de que existiera el recorrido guiado por zonas, o se subieron sueltas.',
      MARGEN, y, { maxWidth: ANCHO_UTIL },
    );
    y += 8;

    let faseActual: FaseFoto | null = null;
    let numeroEnFase = 0;
    const totalPorFase = {
      salida: sinZona.filter(f => f.fase === 'salida').length,
      entrada: sinZona.filter(f => f.fase === 'entrada').length,
    };
    for (const foto of sinZona) {
      if (foto.fase !== faseActual) {
        faseActual = foto.fase;
        numeroEnFase = 0;
        encabezadoGrupo(FASE_LABEL[faseActual], 40);
      }
      numeroEnFase++;
      await ponerFoto(foto, `${FASE_CORTA[foto.fase]} ${numeroEnFase} de ${totalPorFase[foto.fase]}`);
    }
  }

  // ── Casillas omitidas, con su motivo, autor y hora ──
  //
  // Es la contraparte del bloqueo: no se puede cerrar una fase sin las 8 fotos, pero
  // sí se puede omitir una escribiendo por qué. Ese "por qué" tiene que quedar en el
  // respaldo, con nombre y hora, o el bloqueo no sirve de nada.
  if (omisiones.length > 0) {
    if (y > ALTO_PAGINA - 60) { doc.addPage(); y = 20; }
    autoTable(doc, {
      startY: y + 6,
      head: [['Zona sin foto', 'Momento', 'Motivo', 'Quién y cuándo']],
      body: omisiones.map(o => [
        `${ordenCasilla(o.casilla)}. ${nombreCasilla(o.casilla)}`,
        o.fase === 'salida' ? 'Entrega' : 'Devolución',
        o.motivo,
        `${o.autor || 'sin nombre'}${o.autor_tipo === 'admin' ? ' (panel)' : ' (mensajero)'}${o.fecha ? ` · ${o.fecha}` : ''}`,
      ]),
      theme: 'grid',
      headStyles: { fillColor: [199, 74, 33] },
      styles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 22 }, 3: { cellWidth: 46 } },
      margin: { left: MARGEN, right: MARGEN },
    });
    y = finalY(doc, y + 30);
    doc.setFontSize(7.5); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
    doc.text(
      'Estas zonas no tienen foto. El motivo lo escribió a mano quien atendió el servicio en el momento de omitirlas.',
      MARGEN, y + 5, { maxWidth: ANCHO_UTIL },
    );
  }

  // ── Pie de página en todas las hojas ──
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(140); doc.setFont('helvetica', 'normal');
    doc.text(
      `${numero} · Respaldo interno del servicio · congelado el ${d.generada_en || '—'} · no constituye factura`,
      MARGEN, ALTO_PAGINA - 8,
    );
    doc.text(`Página ${i} de ${paginas}`, 196, ALTO_PAGINA - 8, { align: 'right' });
  }

  return doc;
}

/**
 * El PDF ya listo para responder desde una ruta de API.
 *
 * Devuelve el `ArrayBuffer` crudo que entrega jsPDF, sin envolverlo en `Buffer` ni en
 * `Uint8Array`: `ArrayBuffer` ya es un `BodyInit` válido, así que `new NextResponse(pdf)`
 * lo responde tal cual. `Buffer.from(arrayBuffer)` copiaría el documento entero, y con
 * 16 fotos pesa unos 10 MB — copias gratis en cada descarga, encima del pico que ya deja
 * jsPDF. (Un `Uint8Array` es una vista, no una copia, pero el tipo `BodyInit` de la
 * plataforma no lo acepta y obligaba a un cast.)
 */
export async function actaPDFBuffer(acta: ActaGuardada): Promise<ArrayBuffer> {
  const doc = await construirActaPDF(acta);
  return doc.output('arraybuffer');
}
