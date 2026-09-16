'use client';
// ── Los DATOS de un contrato: verlos y completarlos ─────────────────────────
//
// Lo que esta pantalla edita son los DATOS. El TEXTO LEGAL no se toca: al guardar,
// el documento se VUELVE A GENERAR desde la plantilla que redactó el abogado con los
// datos nuevos, y se recalcula todo lo derivado (canon total, IVA, penas, comisión).
// Por eso aquí no hay ninguna caja de texto con cláusulas dentro: no la habrá nunca.
//
// Tres cosas que no son decorativas:
//
//  1. CADA CAMPO DICE DÓNDE SE GUARDA. Lo del vehículo y lo de la persona van a su
//     ficha (y por eso el próximo contrato de ese mismo carro ya sale lleno); lo de
//     la operación, solo a este documento. Quien edita tiene que saber qué está
//     tocando: un número de chasis se escribe una vez en la vida.
//  2. SE MUESTRA EL DATO COMO VA A SALIR IMPRESO, en letras y en cifras, mientras se
//     escribe. Es lo mismo que va a decir el documento — sale de los mismos
//     conversores que usan las plantillas (lib/contratos-texto.ts).
//  3. SOLO MIENTRAS ESTÉ SIN FIRMAR. Si el documento ya se firmó, o ya tiene vía de
//     firma elegida, esto se vuelve una ficha de solo lectura y dice por qué.
//
// Componente de cliente puro: solo importa módulos PUROS (lib/contratos-campos.ts y
// lib/contratos-texto.ts), nunca los de servidor.
import { useCallback, useEffect, useState } from 'react';
import { campoEditable, comoSeImprime, validarCampo, MAX_CONDUCTORES } from '@/lib/contratos-campos';
import { montoEnLetras, pesos } from '@/lib/contratos-texto';

type CampoLeido = {
  clave: string; etiqueta: string; grupo: string; tipo: string; ayuda: string;
  soloLectura: boolean; seCambiaEn: string;
  opciones: { valor: string; etiqueta: string }[];
  valor: string; impreso: string; falta: boolean; bloquea: boolean;
  /** ¿Este documento imprime este dato? (los seis comparten las mismas fichas). */
  enEsteDocumento: boolean;
  seGuardaEn: string;
};

type GrupoLeido = { clave: string; titulo: string; nota: string; campos: CampoLeido[] };

type Conductor = {
  nombre: string; documento: string;
  licenciaNumero: string; licenciaCategoria: string; licenciaVence: string;
};

type Derivados = {
  dias: number; canonDiario: number; canonTotal: number; ivaActivo: boolean; ivaTarifa: number;
  ivaCanon: number; totalArrendatario: number; comisionPct: number; comisionValor: number;
  netoPropietario: number; penaMoraDiaria: number; clausulaPenalArrendamiento: number; deposito: number;
  canonRecaudado: number; ajusteRedondeoCanon: number;
};

type Datos = {
  contrato: {
    id: number; tipo: string; titulo: string; numero: string; version: number;
    estado: string; datos_revision: number; datos_editados_en: string; datos_editados_por_nombre: string;
  };
  editable: boolean;
  motivo: string;
  grupos: GrupoLeido[];
  conductores: Conductor[];
  maxConductores: number;
  derivados: Derivados;
  avisos: string[];
};

type Cargado = { datos: Datos | null; error: string };

type Props = {
  contratoId: number;
  /** Se llama tras guardar: el documento cambió y quien lo muestre debe recargarlo. */
  onGuardado?: () => void;
};

const CONDUCTOR_VACIO: Conductor = {
  nombre: '', documento: '', licenciaNumero: '', licenciaCategoria: '', licenciaVence: '',
};

const claseInput =
  'w-full border border-border rounded-xl px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60';

function tipoHtml(tipo: string): string {
  if (tipo === 'fecha') return 'date';
  if (tipo === 'hora') return 'time';
  return 'text';
}

export default function ContratoDatos({ contratoId, onGuardado }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState('');

  // Solo lo que el usuario TOCÓ. Se manda únicamente eso: así dos personas pueden
  // completar campos distintos del mismo documento sin pisarse.
  const [editado, setEditado] = useState<Record<string, string>>({});
  const [conductores, setConductores] = useState<Conductor[] | null>(null);

  const cargar = useCallback(async (): Promise<Cargado> => {
    try {
      const res = await fetch(`/api/contratos/${contratoId}/datos`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { datos: null, error: json.error || 'No se pudieron cargar los datos.' };
      return { datos: json as Datos, error: '' };
    } catch {
      return { datos: null, error: 'No se pudieron cargar los datos.' };
    }
  }, [contratoId]);

  const aplicar = useCallback((r: Cargado) => {
    setDatos(r.datos);
    setError(r.error);
    setCargando(false);
    setEditado({});
    setConductores(null);
  }, []);

  useEffect(() => {
    let vivo = true;
    cargar().then(r => { if (vivo) aplicar(r); });
    return () => { vivo = false; };
  }, [cargar, aplicar]);

  if (cargando) return <p className="text-sm text-ink/50">Cargando los datos del documento…</p>;
  if (!datos) {
    return (
      <div className="bg-danger/5 border border-danger/25 rounded-2xl p-5 text-center">
        <p className="text-danger text-sm">{error || 'No se pudieron cargar los datos.'}</p>
      </div>
    );
  }

  const listaConductores = conductores ?? datos.conductores;
  const puedeEditar = datos.editable;

  const valorDe = (c: CampoLeido) => (c.clave in editado ? editado[c.clave] : c.valor);

  const errorDe = (c: CampoLeido): string => {
    if (!(c.clave in editado)) return '';
    const def = campoEditable(c.clave);
    if (!def) return '';
    const v = validarCampo(def, editado[c.clave]);
    return v.ok ? '' : v.error;
  };

  const vistaImpresa = (c: CampoLeido): string => {
    const def = campoEditable(c.clave);
    if (!def) return c.impreso;
    const valor = valorDe(c);
    if (!valor) return '';
    return comoSeImprime(def, valor) || valor;
  };

  const hayErrores = datos.grupos.some(g => g.campos.some(c => errorDe(c) !== ''));
  const hayCambios = Object.keys(editado).length > 0
    || (conductores !== null && JSON.stringify(conductores) !== JSON.stringify(datos.conductores));

  const guardar = async () => {
    if (!puedeEditar || !hayCambios || hayErrores) return;
    setGuardando(true);
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/contratos/${contratoId}/datos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campos: editado,
          ...(conductores !== null ? { conductores } : {}),
          revision: datos.contrato.datos_revision,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudieron guardar los datos.');
        return;
      }
      const cambios = Array.isArray(json.cambios) ? json.cambios.length : 0;
      setOk(`Se guardaron ${cambios} dato(s) y se regeneró el texto del documento.`);
      if (json.datos) {
        aplicar({ datos: json.datos as Datos, error: '' });
      } else {
        aplicar(await cargar());
      }
      onGuardado?.();
    } catch {
      setError('No se pudieron guardar los datos.');
    } finally {
      setGuardando(false);
    }
  };

  const cambiarConductor = (i: number, campo: keyof Conductor, valor: string) => {
    const base = [...listaConductores];
    base[i] = { ...base[i], [campo]: valor };
    setConductores(base);
  };

  const d = datos.derivados;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-ink text-sm">Datos del documento</h3>
        <p className="text-[11px] text-ink/60 mt-0.5">
          Aquí se cambian los <strong>datos</strong>. El texto de las cláusulas no se edita: al guardar, el documento se
          vuelve a generar con los datos nuevos y se recalculan el canon, el IVA, la comisión y las penas.
        </p>
        {datos.contrato.datos_editados_en && (
          <p className="text-[11px] text-ink/40 mt-0.5">
            Última edición: {datos.contrato.datos_editados_en.slice(0, 16)}
            {datos.contrato.datos_editados_por_nombre ? ` por ${datos.contrato.datos_editados_por_nombre}` : ''}
            {' '}· revisión {datos.contrato.datos_revision}
          </p>
        )}
      </div>

      {!puedeEditar && (
        <p className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-xl px-3.5 py-2.5">
          {datos.motivo} Lo que sigue es solo de lectura.
        </p>
      )}

      {error && <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-xl px-3.5 py-2.5">{error}</p>}
      {ok && <p className="text-xs text-success bg-success/10 border border-success/25 rounded-xl px-3.5 py-2.5">{ok}</p>}

      {datos.avisos.length > 0 && (
        <div className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-xl px-3.5 py-2.5">
          <p className="font-semibold mb-1">Revisa esto antes de firmar:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {datos.avisos.map(a => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      {datos.grupos.map(g => (
        <div key={g.clave} className="bg-surface-2 border border-border rounded-xl p-3.5">
          <p className="text-sm font-semibold text-ink">{g.titulo}</p>
          <p className="text-[11px] text-ink/50 mt-0.5 mb-3">{g.nota}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {g.campos.map(c => {
              const err = errorDe(c);
              const impreso = vistaImpresa(c);
              return (
                <div key={c.clave}>
                  <label className="text-xs font-medium text-ink/60 block mb-1">
                    {c.etiqueta}
                    {c.falta && (
                      <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${c.bloquea ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'}`}>
                        {c.bloquea
                          ? 'falta · impide firmar'
                          : c.enEsteDocumento ? 'falta · sale en blanco' : 'falta · en otro documento'}
                      </span>
                    )}
                  </label>

                  {c.opciones.length > 0 ? (
                    <select
                      value={valorDe(c)}
                      disabled={!puedeEditar || c.soloLectura || guardando}
                      onChange={e => setEditado(prev => ({ ...prev, [c.clave]: e.target.value }))}
                      className={claseInput}
                    >
                      <option value="">Sin definir</option>
                      {c.opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                    </select>
                  ) : (
                    <input
                      type={tipoHtml(c.tipo)}
                      value={valorDe(c)}
                      disabled={!puedeEditar || c.soloLectura || guardando}
                      onChange={e => setEditado(prev => ({ ...prev, [c.clave]: e.target.value }))}
                      className={claseInput}
                    />
                  )}

                  {c.ayuda && <p className="text-[10px] text-ink/40 mt-1">{c.ayuda}</p>}
                  {c.soloLectura && c.seCambiaEn && (
                    <p className="text-[10px] text-ink/40 mt-1">Se cambia en {c.seCambiaEn}.</p>
                  )}
                  {!c.soloLectura && (
                    <p className="text-[10px] text-ink/35 mt-1">Se guarda en: {c.seGuardaEn}.</p>
                  )}
                  {impreso && !err && (
                    <p className="text-[10px] text-accent mt-1 break-words">Saldrá impreso: {impreso}</p>
                  )}
                  {err && <p className="text-[10px] text-danger mt-1">{err}</p>}
                </div>
              );
            })}
          </div>

          {/* Los conductores autorizados son de ESTA operación: no hay ficha donde
              guardarlos (no son cuentas de la plataforma), así que viven en el contrato. */}
          {g.clave === 'operacion' && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold text-ink">Conductores autorizados distintos del arrendatario</p>
              <p className="text-[10px] text-ink/40 mt-0.5 mb-2">
                Salen nombrados en el otrosí y en el acta, y cada uno abre un bloque de firma de codeudor en el pagaré.
                Máximo {datos.maxConductores || MAX_CONDUCTORES}.
              </p>

              {listaConductores.length === 0 && (
                <p className="text-[11px] text-ink/50 mb-2">Ninguno: el único conductor autorizado es el arrendatario.</p>
              )}

              {/* Aviso que hay que dar ANTES de guardar, no después: en el pagaré cada
                  conductor abre un bloque de CODEUDOR SOLIDARIO, y la plataforma todavía
                  no sabe recoger firmas de codeudores (no tienen cuenta). Un pagaré con
                  codeudores solo se puede completar por la vía de papel del mostrador. */}
              {datos.contrato.tipo === 'pagare' && listaConductores.length > 0 && (
                <p className="text-[11px] text-warning bg-warning/10 border border-warning/25 rounded-xl px-3 py-2 mb-2">
                  Ojo: en el pagaré, cada conductor autorizado abre un bloque de <strong>codeudor solidario</strong>, y
                  todavía no se pueden recoger firmas de codeudores en la plataforma. Con conductores, este pagaré solo
                  se podrá firmar <strong>en papel</strong> (imprimirlo, firmarlo a mano y subir el escaneado).
                </p>
              )}

              {listaConductores.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-5 mb-2">
                  <input
                    placeholder="Nombre completo" value={c.nombre} disabled={!puedeEditar || guardando}
                    onChange={e => cambiarConductor(i, 'nombre', e.target.value)} className={claseInput}
                  />
                  <input
                    placeholder="Documento" value={c.documento} disabled={!puedeEditar || guardando}
                    onChange={e => cambiarConductor(i, 'documento', e.target.value)} className={claseInput}
                  />
                  <input
                    placeholder="Licencia No." value={c.licenciaNumero} disabled={!puedeEditar || guardando}
                    onChange={e => cambiarConductor(i, 'licenciaNumero', e.target.value)} className={claseInput}
                  />
                  <input
                    placeholder="Categoría" value={c.licenciaCategoria} disabled={!puedeEditar || guardando}
                    onChange={e => cambiarConductor(i, 'licenciaCategoria', e.target.value)} className={claseInput}
                  />
                  <div className="flex gap-2">
                    <input
                      type="date" value={c.licenciaVence} disabled={!puedeEditar || guardando}
                      onChange={e => cambiarConductor(i, 'licenciaVence', e.target.value)} className={claseInput}
                    />
                    {puedeEditar && (
                      <button
                        type="button"
                        onClick={() => setConductores(listaConductores.filter((_, j) => j !== i))}
                        className="text-xs font-semibold text-danger hover:underline shrink-0"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {puedeEditar && listaConductores.length < (datos.maxConductores || MAX_CONDUCTORES) && (
                <button
                  type="button"
                  onClick={() => setConductores([...listaConductores, { ...CONDUCTOR_VACIO }])}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  + Agregar conductor autorizado
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Lo derivado NO se edita: se calcula. Se muestra para que quien edita el canon
          vea en el acto qué cifras van a cambiar en el documento. */}
      <div className="bg-surface-2 border border-border rounded-xl p-3.5">
        <p className="text-sm font-semibold text-ink">Lo que se calcula solo</p>
        <p className="text-[11px] text-ink/50 mt-0.5 mb-2">
          Sale del canon diario y de los días de la reserva. No se edita a mano: si cambia el canon, cambia todo esto.
        </p>
        <ul className="text-[11px] text-ink/70 space-y-1">
          <li>Días del arrendamiento: <strong>{d.dias}</strong></li>
          <li>Canon diario: <strong>{montoEnLetras(d.canonDiario || 0)}</strong></li>
          <li>Canon total: <strong>{montoEnLetras(d.canonTotal || 0)}</strong></li>
          <li>
            IVA: {d.ivaActivo ? <strong>{montoEnLetras(d.ivaCanon || 0)} ({d.ivaTarifa}%)</strong> : <strong>no se cobra</strong>}
          </li>
          <li>Total a cargo del arrendatario: <strong>{montoEnLetras(d.totalArrendatario || 0)}</strong></li>
          <li>Comisión de DrivePass ({d.comisionPct}%): <strong>{montoEnLetras(d.comisionValor || 0)}</strong></li>
          <li>Saldo al propietario: <strong>{montoEnLetras(d.netoPropietario || 0)}</strong></li>
          <li>Pena de mora por día: <strong>{montoEnLetras(d.penaMoraDiaria || 0)}</strong></li>
          <li>Cláusula penal (30%): <strong>{montoEnLetras(d.clausulaPenalArrendamiento || 0)}</strong></li>
          <li>Depósito de garantía: <strong>{montoEnLetras(d.deposito || 0)}</strong></li>
        </ul>
        {d.ajusteRedondeoCanon !== 0 && (
          <p className="text-[11px] text-danger mt-2">
            Descuadre: se recaudaron {pesos(d.canonRecaudado)} por el alquiler, pero el canon del documento suma{' '}
            {pesos(d.canonTotal)} ({d.ajusteRedondeoCanon > 0 ? '+' : ''}{pesos(Math.abs(d.ajusteRedondeoCanon))} de diferencia).
            Ajusta el canon diario antes de firmar: el documento no puede decir un total distinto del que se cobró.
          </p>
        )}
      </div>

      {puedeEditar && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={guardar}
            disabled={!hayCambios || hayErrores || guardando}
            className="bg-accent hover:bg-accent/85 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50"
          >
            {guardando ? 'Guardando y regenerando…' : 'Guardar datos y regenerar el documento'}
          </button>
          {hayCambios && !guardando && (
            <button
              type="button"
              onClick={() => { setEditado({}); setConductores(null); setOk(''); }}
              className="text-xs font-semibold text-ink/60 hover:underline"
            >
              Descartar cambios
            </button>
          )}
          {hayErrores && <span className="text-[11px] text-danger">Corrige los campos marcados en rojo.</span>}
        </div>
      )}
    </div>
  );
}
