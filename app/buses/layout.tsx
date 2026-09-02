import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Alquiler de buses y busetas en Medellín | DrivePass',
  description:
    'Cotiza en segundos el alquiler de tu bus, buseta o microbús para viajes ocasionales en Medellín. Por destino, por trayecto o por horas de disponibilidad.',
};

export default function BusesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
