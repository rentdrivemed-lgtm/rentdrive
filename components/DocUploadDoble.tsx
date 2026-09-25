'use client';
import { useState } from 'react';
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
  /**
   * Ver el mismo prop en DocUpload: destaca el botón de cámara, que es como la mayoría
   * fotografía su cédula desde el celular.
   *
   * NO restringe el formato — el comentario anterior decía que era «para documentos que
   * nunca son un PDF», y eso dejó de ser cierto en sep-2026: la cédula y la licencia
   * admiten PDF, y la verificación con IA los lee nativos, todas sus páginas.
   */
  preferirCamara?: boolean;
  /**
   * Con `required`, muestra debajo qué lado falta en vez de dejar solo el
   * asterisco. Opcional para no cambiarle el aspecto a los usos que ya existían.
   */
  mostrarFaltantes?: boolean;
};

export default function DocUploadDoble({ label, valueFrente, valueDorso, onChangeFrente, onChangeDorso, required, soloUnLado, preferirCamara, mostrarFaltantes }: Props) {
  /**
   * Mucha gente llega con las dos caras en un único archivo: el PDF de la cédula
   * digital del RUNT trae anverso y reverso, y en las fotocopias de matrícula y
   * licencia es igual de común. Antes eso obligaba a subir el mismo archivo dos
   * veces (funcionaba, pero nadie adivina que hay que hacerlo) o a recortarlo.
   *
   * `null` = el usuario todavía no ha tocado la casilla, así que se deduce de lo
   * ya guardado: el mismo archivo repetido en los dos lados solo puede venir de
   * haberlo subido así, y al volver al formulario la casilla aparece marcada.
   */
  const [marcadaPorElUsuario, setMarcada] = useState<boolean | null>(null);
  const unSoloArchivo = !soloUnLado && (marcadaPorElUsuario ?? (!!valueFrente && valueFrente === valueDorso));

  /**
   * Con un solo archivo el dorso NO es opcional: es el mismo archivo, así que lo que
   * hay que comprobar no es "¿hay dorso?" sino "¿el dorso es la copia del frente?".
   *
   * Darlo por bueno vacío (que es lo que hacía pasarle `soloUnLado || unSoloArchivo`)
   * abría un agujero silencioso: marcar la casilla, activar pasaporte, subir y volver
   * a desactivarlo deja el modo activo con el dorso vacío, la pantalla sin avisar de
   * nada y el servidor rechazando después. Comparando contra el frente, ese estado se
   * señala como "falta el archivo" y se arregla con solo volver a subirlo.
   */
  const faltan: LadoDocumento[] = !required || !mostrarFaltantes
    ? []
    : unSoloArchivo
      ? (valueFrente && valueDorso === valueFrente ? [] : ['frente'])
      : ladosFaltantes(valueFrente, valueDorso, soloUnLado);

  // Un dorso distinto que ya estaba subido se recuerda para poder devolverlo al
  // desmarcar: marcar la casilla no puede ser una forma silenciosa de perder un
  // archivo (si venía de `registro-temp/`, la limpieza lo borra a las 48 h).
  const [dorsoPrevio, setDorsoPrevio] = useState('');

  /**
   * Con un solo archivo el dorso deja de ser un campo aparte, pero se guarda
   * REPETIDO en las dos columnas en vez de vacío. Así todo lo que hoy exige las
   * dos caras —el servidor, los contratos, la vista del admin— sigue viendo un
   * dorso y no hubo que tocar ni el esquema ni una sola validación. Reutilizar
   * la URL es seguro: la limpieza de huérfanos borra lo que NO está referenciado,
   * y esta lo está dos veces.
   */
  function cambiarFrente(url: string) {
    onChangeFrente(url);
    if (unSoloArchivo) onChangeDorso(url);
  }

  function alternarUnSoloArchivo(activar: boolean) {
    setMarcada(activar);
    if (activar) {
      if (valueDorso && valueDorso !== valueFrente) setDorsoPrevio(valueDorso);
      onChangeDorso(valueFrente);
      return;
    }
    // Al desmarcar se devuelve el dorso que hubiera antes; si no lo había, solo se
    // limpia cuando era la copia, para no borrarle al usuario un archivo distinto.
    if (dorsoPrevio) { onChangeDorso(dorsoPrevio); setDorsoPrevio(''); return; }
    if (valueDorso === valueFrente) onChangeDorso('');
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={unSoloArchivo ? undefined : 'grid grid-cols-2 gap-3'}>
        <DocUpload
          label={soloUnLado ? label : unSoloArchivo ? `${label} (ambos lados)` : `${label} (frente)`}
          value={valueFrente} onChange={cambiarFrente} required={required} preferirCamara={preferirCamara} />
        {!soloUnLado && !unSoloArchivo && (
          <DocUpload label={`${label} (dorso)`} value={valueDorso} onChange={onChangeDorso} required={required} preferirCamara={preferirCamara} />
        )}
      </div>
      {!soloUnLado && (
        <label className="flex items-center gap-2 text-[11px] text-ink/60 w-fit cursor-pointer">
          <input type="checkbox" checked={unSoloArchivo} onChange={e => alternarUnSoloArchivo(e.target.checked)} />
          Los dos lados están en un mismo archivo
        </label>
      )}
      {/* Sin repetir la etiqueta: el mensaje va justo debajo de los dos recuadros,
          y meterla daba frases torcidas ("Falta el dorso de foto de tu cédula"). */}
      {faltan.length > 0 && (
        <p className="text-[11px] text-danger">
          {unSoloArchivo
            ? 'Falta el archivo.'
            : `Falta ${faltan.length === 2 ? 'el frente y el dorso' : faltan[0] === 'frente' ? 'el frente' : 'el dorso'}.`}
        </p>
      )}
    </div>
  );
}
