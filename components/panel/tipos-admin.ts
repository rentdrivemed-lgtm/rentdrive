// ── Tipos y constantes compartidos de las secciones del panel ───────────────
//
// Salieron TAL CUAL de app/dashboard/admin/page.tsx al partir ese archivo en cuatro
// secciones (Personas, Vehículos, Reservas y Mercado). Viven acá porque ahora los
// consumen DOS pantallas: el panel de siempre (/dashboard/admin) y el panel unificado
// (/panel), que montan exactamente los mismos componentes.
//
// Módulo PURO: solo tipos, tablas de etiquetas y funciones sin estado. No importa nada
// de servidor (`fs`, `better-sqlite3`), así que lo puede usar cualquier componente de
// cliente.


export type Usuario = {
  id: number; nombre: string; correo: string;
  rol: string; admin_nivel?: string; permisos_extra?: string; estado_cuenta: string; created_at: string;
  tipo_documento?: string; documento_identidad?: string;
  fecha_nacimiento?: string; celular?: string; celular_indicativo?: string;
  direccion?: string; ciudad?: string;
  numero_licencia?: string; contacto_emergencia?: string;
  cedula_url?: string; cedula_url_dorso?: string;
  // Documentos del perfil que antes no se mostraban en ninguna pantalla — en
  // particular el certificado bancario del propietario, que se pedía como
  // obligatorio y después no había forma de verlo (ver GET /api/admin/usuarios).
  licencia_url?: string; licencia_url_dorso?: string;
  certificado_bancario_url?: string;
  banco?: string; numero_cuenta?: string;
};
export type DocItem = { url: string; vence?: string };
// `todo_riesgo` ya no aparece acá (sep-2026): DrivePass expide la póliza directamente, así
// que dejó de pedirse y de revisarse. Los vehículos que ya la tenían conservan la clave en
// `documentos` en la BD (nadie la borra), simplemente ya no se muestra en este panel.
export type Documentos = {
  soat?: DocItem;
  tecno?: DocItem;
  tarjeta?: { url: string; url_dorso?: string };
};

export type DocRevision = { estado: string; nota: string };

export type Vehiculo = {
  id: number; marca: string; modelo: string; anio: number; tipo: string;
  precio_dia: number; propietario_id: number; propietario_nombre: string; disponible: number;
  fotos: string; fotos_detalle: string; placa?: string; documentos?: string;
  // Calendario de disponibilidad (array JSON de fechas 'YYYY-MM-DD'). Llega en el
  // `SELECT v.*` del panel y NO está entre los campos sensibles de lib/vehiculo-publico.ts.
  // ⚠️ `'[]'` NO significa "cerrado": significa "abierto sin restricciones" (ver
  // lib/dias-disponibles.ts).
  dias_disponibles?: string;
  combustible?: string; clase_vehiculo?: string; exencion_pico_placa_inscrita?: number;
  documentos_estado?: string; documentos_nota?: string; documentos_revisiones?: string;
  en_vitrina?: number; archivado?: number;
  contenido_revision?: number; contenido_revision_motivo?: string;
  // Fecha de llegada del vehículo a la plataforma. Viaja en el `SELECT v.*` de
  // GET /api/vehiculos y no está entre los campos sensibles de lib/vehiculo-publico.ts.
  // ⚠️ Está guardada en UTC (lib/db.ts usa `datetime('now')` para esta tabla): se muestra
  // y se filtra SIEMPRE a través de lib/fecha-registro.ts, nunca en crudo.
  created_at?: string;
};

export const DOC_LABELS: Record<string, string> = {
  soat: 'SOAT', tecno: 'Tecno-mecánica',
  tarjeta: 'Tarjeta de propiedad',
};

/**
 * Texto en minúsculas y SIN tildes, para que la búsqueda no obligue a escribirlas:
 * "gomez" encuentra a "Gómez" y "pena" encuentra a "Peña". Se aplica igual a lo que se
 * escribe y a lo que se compara, así que también funciona al revés (escribir con tilde
 * encuentra un dato guardado sin ella).
 */
export function plano(texto: unknown): string {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
