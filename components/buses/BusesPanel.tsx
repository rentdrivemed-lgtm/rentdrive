'use client';
import { useState } from 'react';
import FlotaBusesTab from './FlotaBusesTab';
import TarifarioReferenciaTab from './TarifarioReferenciaTab';
import CambiosTarifasTab from './CambiosTarifasTab';
import CotizacionesBusesTab from './CotizacionesBusesTab';
import ConfiguracionBusesTab from './ConfiguracionBusesTab';

type SubTab = 'flota' | 'tarifario' | 'cambios' | 'cotizaciones' | 'config';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'flota', label: 'Flota de buses' },
  { key: 'tarifario', label: 'Tarifario de referencia' },
  { key: 'cambios', label: '🕓 Cambios de tarifas' },
  { key: 'cotizaciones', label: 'Cotizaciones' },
  { key: 'config', label: 'Configuración' },
];

// Panel admin de Buses (Etapa 3, ver COTIZADOR-BUSES-SPEC.md §5). Cada sub-sección gestiona
// su propio fetch/estado de forma independiente (ver components/buses/*Tab.tsx) — este
// componente solo orquesta las pestañas internas, mismo patrón de sub-tabs que ya usa
// ContabilidadPanel/SoportePanel.
export default function BusesPanel() {
  const [subTab, setSubTab] = useState<SubTab>('flota');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-bold text-ink text-lg flex items-center gap-2">🚌 Buses</h2>
        <p className="text-sm text-ink/50">Flota, tarifario de referencia, cola de aprobación de tarifas y cotizaciones del cotizador de buses.</p>
      </div>

      <div className="flex gap-1 border-b border-border flex-wrap">
        {SUBTABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              subTab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink/50 hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'flota' && <FlotaBusesTab />}
      {subTab === 'tarifario' && <TarifarioReferenciaTab />}
      {subTab === 'cambios' && <CambiosTarifasTab />}
      {subTab === 'cotizaciones' && <CotizacionesBusesTab />}
      {subTab === 'config' && <ConfiguracionBusesTab />}
    </div>
  );
}
