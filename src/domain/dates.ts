/** Limites de mês em ISO. Antes cada camada (planner, contexto, API) tinha a sua cópia. */

export const pad2 = (value: number) => String(value).padStart(2, '0');

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(lastDay)}` };
}

/** "aaaa-mm" -> primeiro e último dia do mês. */
export function monthFromIso(isoMonth: string): { from: string; to: string } {
  const [year, month] = isoMonth.split('-').map(Number);
  return monthBounds(year!, month!);
}

/** Desloca meses a partir de uma data ISO, em vez de a partir de "hoje". */
export function shiftMonth(iso: string, delta: number): { from: string; to: string } {
  const [year, month] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return monthBounds(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}
