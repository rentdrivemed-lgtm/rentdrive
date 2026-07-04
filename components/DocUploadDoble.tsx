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
};

export default function DocUploadDoble({ label, valueFrente, valueDorso, onChangeFrente, onChangeDorso, required, soloUnLado }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DocUpload label={soloUnLado ? label : `${label} (frente)`} value={valueFrente} onChange={onChangeFrente} required={required} />
      {!soloUnLado && (
        <DocUpload label={`${label} (dorso)`} value={valueDorso} onChange={onChangeDorso} required={required} />
      )}
    </div>
  );
}
