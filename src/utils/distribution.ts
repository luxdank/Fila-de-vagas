import { Participante, DistribuicaoItem } from '../types';

/**
 * Distributes a given number of vacancies equally among the participants in the queue.
 * Each participant gets a base number of vacancies, and any remainder is distributed
 * one by one to the participants starting from the top of the queue.
 */
export function distribuirVagas(fila: Participante[], totalVagas: number): DistribuicaoItem[] {
  if (fila.length === 0 || totalVagas <= 0) {
    return [];
  }
  
  const numParticipantes = fila.length;
  const baseVagas = Math.floor(totalVagas / numParticipantes);
  const restoVagas = totalVagas % numParticipantes;
  
  return fila.map((p, index) => {
    const vagasParaEste = baseVagas + (index < restoVagas ? 1 : 0);
    return {
      nome: p.nome,
      vagas: vagasParaEste
    };
  });
}

/**
 * Rotates the queue after a distribution.
 * Moves the participants who received vacancies to the end of the queue.
 * If totalVagas >= fila.length, everyone got vacancies (at least the base amount),
 * so we can either keep the order or rotate by the remainder.
 * Let's rotate by shifting the first `vagas % fila.length` or `vagas` participants to the end.
 */
export function rotacionarFila(fila: Participante[], totalVagas: number): Participante[] {
  if (fila.length <= 1 || totalVagas <= 0) {
    return [...fila];
  }

  // Calculate how many positions to shift.
  // If we have 9 participants and 5 vacancies, we shift 5 participants to the end.
  // If we have 9 participants and 12 vacancies, we shift 12 % 9 = 3 participants to the end,
  // since everyone got at least 1, and the first 3 got an extra one.
  const shiftAmount = totalVagas % fila.length;
  
  // If shiftAmount is 0 (e.g. 9 vacancies for 9 participants, everyone got exactly 1),
  // we don't necessarily have to shift, or we could shift all of them (which results in the same order).
  if (shiftAmount === 0) {
    return [...fila];
  }

  const served = fila.slice(0, shiftAmount);
  const unserved = fila.slice(shiftAmount);
  
  return [...unserved, ...served];
}
