/** Pergunta do usuário: limpeza e bloqueio de injeção num lugar só (API e planner usavam cópias). */

export const MAX_QUESTION_LENGTH = 300;

export function sanitizeQuestion(question: string): string {
  const clean = question.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, MAX_QUESTION_LENGTH);
}

/** Sem acento e minúsculo: o padrão não depende de "instruções" x "instrucoes". */
function normalizeForGuard(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const INJECTION_PATTERNS = [
  // inglês
  /ignore\b[^.]*\b(instructions|rules|prompt)/,
  /system prompt/,
  /you are now/,
  /jailbreak/,
  /reveal\b[^.]*\b(prompt|instructions)/,
  /forget (everything|all)/,
  /disregard\b[^.]*\b(instructions|rules)/,

  // português: troca de instrução
  /(ignore|ignorar|ignora|desconsidere|desconsiderar|esqueca|esquecer|abandone)\b[^.]*\b(instrucoes|regras|comandos|orientacoes|prompt)/,
  /(repita|repita-me|mostre|revele)\b[^.]*\b(instrucoes|regras) (acima|anteriores|do sistema)/,
  /prompt (do|de) sistema|prompt inicial|prompt original/,

  // português: troca de papel / modo
  /\b(voce|vc) (agora )?(e|eh) (um|uma)\b/,
  /\b(aja|comporte-se|finja|finge|pretenda)\b[^.]*\b(como|ser|que (e|eh|es) (um|uma))\b/,
  /modo (desenvolvedor|dev|irrestrito|sem restricoes|admin|jailbreak)/,

  // segredo: não existe pergunta legítima sobre extrato que peça isso
  /\b(senha|password|credenciais|credencial|api key|chave de api|chave api)\b/,
];

export function looksLikeInjection(question: string): boolean {
  const normalized = normalizeForGuard(question);
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
