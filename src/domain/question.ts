/** Pergunta do usuário: limpeza e bloqueio de injeção num lugar só (API e planner usavam cópias). */

export const MAX_QUESTION_LENGTH = 300;

export function sanitizeQuestion(question: string): string {
  const clean = question.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, MAX_QUESTION_LENGTH);
}

const INJECTION_PATTERNS = [
  /ignore\b[^.]*\b(instructions|rules|prompt)/i,
  /system prompt/i,
  /you are now/i,
  /jailbreak/i,
  /reveal\b[^.]*\b(prompt|instructions)/i,
  /forget (everything|all)/i,
  /disregard\b[^.]*\b(instructions|rules)/i,
];

export function looksLikeInjection(question: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(question));
}
