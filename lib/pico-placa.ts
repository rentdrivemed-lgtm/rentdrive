// Pico y placa (restricción vehicular de Medellín por último dígito de placa).
export type PicoPlaca = {
  activo: boolean;
  vigencia: string;
  dias: Record<string, number[]>;
};
export const DIAS_SEMANA: { id: string; nombre: string }[] = [
  { id: '1', nombre: 'Lunes' },
  { id: '2', nombre: 'Martes' },
  { id: '3', nombre: 'Miércoles' },
  { id: '4', nombre: 'Jueves' },
  { id: '5', nombre: 'Viernes' },
];