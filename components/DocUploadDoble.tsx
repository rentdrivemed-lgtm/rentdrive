'use client';
import DocUpload from '@/components/DocUpload';

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
};

export default function DocUploadDoble({ label, valueFrente, valueDorso, onChangeFrente, onChangeDorso, required, soloUnLado, soloImagen }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DocUpload label={soloUnLado ? label : `${label} (frente)`} value={valueFrente} onChange={onChangeFrente} required={required} soloImagen={soloImagen} />
      {!soloUnLado && (
        <DocUpload label={`${label} (dorso)`} value={valueDorso} onChange={onChangeDorso} required={required} soloImagen={soloImagen} />
      )}
    </div>
  );
}
