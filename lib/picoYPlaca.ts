// Pico y placa Medellín — horario para vehículos particulares
// Lunes=1: dígitos 1,2 | Martes=2: 3,4 | Miércoles=3: 5,6 | Jueves=4: 7,8 | Viernes=5: 9,0
const DIGITO_DIA: Record<number, number[]> = {
  1: [1, 2],
  2: [3, 4],
  3: [5, 6],
  4: [7, 8],
  5: [9, 0],
};

export function ultimoDigito(placa: string): number | null {
  const digitos = placa.replace(/\D/g, '');
  if (!digitos) return null;
  return parseInt(digitos[digitos.length - 1]);
}

export function diasPicoYPlaca(placa: string, year: number, month: number): string[] {
  const digito = ultimoDigito(placa);
  if (digito === null) return [];
  const diasRestringidos = Object.entries(DIGITO_DIA)
    .filter(([, digits]) => (digits as number[]).includes(digito))
    .map(([day]) => parseInt(day));
  const dias: string[] = [];
  const totalDias = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= totalDias; d++) {
    const fecha = new Date(year, month, d);
    if (diasRestringidos.includes(fecha.getDay())) {
      dias.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  return dias;
}
