import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Gana dinero con tu carro en Medellín | Calculadora DrivePass',
  description:
    'Calcula gratis cuánto puedes ganar alquilando tu carro en Medellín con DrivePass. Ingresa tu vehículo y descubre tu ingreso mensual estimado en minutos.',
};

export default function CalculadoraPropietariosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
