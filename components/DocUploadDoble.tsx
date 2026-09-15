'use client';
import DocUpload from '@/components/DocUpload';

export type LadoDocumento = 'frente' | 'dorso';

/**
 * Lados que todavía faltan de un documento de dos caras.
 *
 * Función pura y exportada a propósito: la regla "el dorso es obligatorio salvo
 * que el documento sea un pasaporte (que no tiene dorso)" la aplican hoy varias
 * pantallas (checkout y perfil del propietario) más sus endpoints, y antes cada
 * una la reescribía a mano. `required` en este componente era puramente
 * cosmético (solo pinta el asterisco en DocUpload) y se pasaba idéntico a los
 * dos lados, así que el componente nunca decía QUÉ lado faltaba.
 *
 * OJO: esto es solo para el feedback en pantalla. La validación que de verdad
 * manda vive en el servidor (POST /api/reservas, PUT /api/auth/me).
 */
export function ladosFaltantes(valueFrente: string, valueDorso: string, soloUnLado?: boolean): LadoDocumento[] {
  const faltan: LadoDocumento[] = [];
  if (!valueFrente) faltan.push('frente');
  if (!soloUnLado && !valueDorso) faltan.push('dorso');
  return faltan;
}

type Props = {
  label: string;
  valueFrente: string;
  valueDorso: string;
  onChangeFrente: (url: string) => void;
  onChangeDorso: (url: string) => void;
  required?: boolean;
  /** Para cédula/pasaporte: si es pasaporte, el dorso no aplica (solo la página con la foto). */
  soloUnLado?: boolean;
  /** Ver el mismo prop en DocUpload — para documentos que nunca son un PDF (cédula/licencia). */
  soloImagen?: boolean;
  /**
   * Con `required`, muestra debajo qué lado falta en vez de dejar solo el
   * asterisco. Opcional para no cambiarle el aspecto a los usos que ya existían.
   */
  mostrarFaltantes?: boolean;
};

export default function DocUploadDoble({ label, valueFrente, valueDorso, onChangeFrente, onChangeDorso, required, soloUnLado, soloImagen, mostrarFaltantes }: Props) {
  const faltan = required && mostrarFaltantes ? ladosFaltantes(valueFrente, valueDorso, soloUnLado) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-3">
        <DocUpload label={soloUnLado ? label : `${label} (frente)`} value={valueFrente} onChange={onChangeFrente} required={required} soloImagen={soloImagen} />
        {!soloUnLado && (
          <DocUpload label={`${label} (dorso)`} value={valueDorso} onChange={onChangeDorso} required={required} soloImagen={soloImagen} />
        )}
      </div>
      {/* Sin repetir la etiqueta: el mensaje va justo debajo de los dos recuadros,
          y meterla daba frases torcidas ("Falta el dorso de foto de tu cédula"). */}
      {faltan.length > 0 && (
        <p className="text-[11px] text-danger">
          Falta {faltan.length === 2 ? 'el frente y el dorso' : faltan[0] === 'frente' ? 'el frente' : 'el dorso'}.
        </p>
      )}
    </div>
  );
}
