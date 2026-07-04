// Integración con DataICO (https://www.dataico.com) — proveedor tecnológico autorizado
// por la DIAN para facturación electrónica en Colombia.
//
// IMPORTANTE — antes de usar esto en producción: el portal técnico de DataICO
// (portaldelcliente.dataico.com) exige una cuenta de cliente para ver el detalle
// completo del esquema JSON, así que el payload de abajo está armado con lo que
// SÍ se pudo confirmar públicamente (endpoint, headers de autenticación, y los
// conceptos que soporta: cliente, items, IVA, AIU, descuentos). Cuando Victor
// tenga acceso a su cuenta DataICO, hay que verificar los nombres exactos de los
// campos contra su documentación técnica y ajustar `construirPayloadFactura` si
// hace falta — el resto del módulo de contabilidad no depende de esto (funciona
// en modo "borrador local" mientras tanto).
const DATAICO_ENDPOINT = 'https://api.dataico.com/direct/dataico_api/v2/invoices';

export function dataicoHabilitado(): boolean {
  return !!(process.env.DATAICO_ACCOUNT_ID && process.env.DATAICO_AUTH_TOKEN);
}

export type ItemFactura = { descripcion: string; cantidad: number; valorUnitario: number };
export type ClienteFactura = { nombre: string; documento?: string; correo?: string; celular?: string };

export type DatosFactura = {
  cliente: ClienteFactura;
  items: ItemFactura[];
  observaciones?: string;
};

export type ResultadoDataico =
  | { emitida: true; numero: string; cufe: string; pdfUrl: string }
  | { emitida: false; error: string };

function construirPayloadFactura(datos: DatosFactura): Record<string, unknown> {
  return {
    cliente: {
      razon_social: datos.cliente.nombre,
      identificacion: datos.cliente.documento || '222222222222', // consumidor final, por defecto
      correo: datos.cliente.correo || '',
      telefono: datos.cliente.celular || '',
    },
    items: datos.items.map(it => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      valor_unitario: it.valorUnitario,
      impuestos: [], // sin IVA por defecto — el servicio de alquiler de DrivePass hoy no discrimina IVA; ajustar aquí si cambia
    })),
    observaciones: datos.observaciones || '',
  };
}

/** Emite una factura electrónica real vía DataICO. Si faltan credenciales, no llama a nada. */
export async function emitirFacturaDataico(datos: DatosFactura): Promise<ResultadoDataico> {
  if (!dataicoHabilitado()) {
    return { emitida: false, error: 'DataICO no está configurado (falta DATAICO_ACCOUNT_ID o DATAICO_AUTH_TOKEN)' };
  }
  try {
    const res = await fetch(DATAICO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        Dataico_account_id: process.env.DATAICO_ACCOUNT_ID!,
        'Auth-token': process.env.DATAICO_AUTH_TOKEN!,
      },
      body: JSON.stringify(construirPayloadFactura(datos)),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { emitida: false, error: data?.message || data?.error || `DataICO respondió ${res.status}` };
    }
    return {
      emitida: true,
      numero: data?.number || data?.numero || '',
      cufe: data?.cufe || '',
      pdfUrl: data?.pdf_url || data?.pdfUrl || '',
    };
  } catch (e) {
    return { emitida: false, error: e instanceof Error ? e.message : 'Error desconocido al conectar con DataICO' };
  }
}
