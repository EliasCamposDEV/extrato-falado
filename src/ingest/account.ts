/**
 * Identidade da conta no import.
 *
 * Sem isso, todo CSV/OFX sem banco no nome cai em "principal" e a detecção de
 * transferência interna (que exige contas diferentes) nunca acha nada.
 * A ordem de precedência é: escolha explícita da pessoa > assinatura do arquivo.
 */

export interface AccountGuess {
  account: string;
  bank: string;
  /** de onde veio: nome do arquivo, cabeçalho OFX ou texto do CSV */
  from: 'filename' | 'ofx' | 'content';
}

const BANK_ID: Record<string, string> = {
  '001': 'bb',
  '033': 'santander',
  '077': 'inter',
  '104': 'caixa',
  '237': 'bradesco',
  '260': 'nubank',
  '336': 'c6',
  '380': 'picpay',
};

/** Marcas que aparecem no nome do arquivo exportado pelo banco. */
const FILENAME_BANKS: Array<[RegExp, string]> = [
  [/^nu[_-]|nubank/, 'nubank'],
  [/itau|itaú/, 'itau'],
  [/banco[_-]?inter|\binter[_-]/, 'inter'],
  [/bradesco/, 'bradesco'],
  [/santander/, 'santander'],
  [/caixa/, 'caixa'],
  [/banco[_-]?do[_-]?brasil|\bbb[_-]/, 'bb'],
  [/picpay/, 'picpay'],
  [/c6[_-]?bank|\bc6[_-]/, 'c6'],
];

/** Assinaturas de cabeçalho que não se confundem com outro banco. */
const CONTENT_BANKS: Array<[RegExp, string]> = [
  [/(^|[,;\t"])\s*identificador\s*([,;\t"]|$)/i, 'nubank'],
  [/nu\s*pagamentos/i, 'nubank'],
  [/nubank\.com\.br/i, 'nubank'],
  [/banco\s+inter/i, 'inter'],
  [/c6\s*bank/i, 'c6'],
  [/picpay/i, 'picpay'],
  [/banco\s+do\s+brasil/i, 'bb'],
  [/dependencia\s+origem/i, 'bb'],
  [/data\s+balancete/i, 'bradesco'],
  [/santander/i, 'santander'],
  [/caixa\s+econ[oô]mica\s+federal/i, 'caixa'],
  [/ita[uú]\s+unibanco/i, 'itau'],
];

function cleanAccount(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Últimos dígitos identificam a conta sem guardar o número inteiro. */
function accountSuffix(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 4 ? digits.slice(-4) : digits;
}

export function guessFromFilename(filename: string): AccountGuess | null {
  const lower = filename.toLowerCase();
  for (const [pattern, bank] of FILENAME_BANKS) {
    if (pattern.test(lower)) return { account: bank, bank, from: 'filename' };
  }
  return null;
}

export function guessFromOfx(text: string): AccountGuess | null {
  const bankId = /<BANKID>\s*(\d+)/i.exec(text)?.[1];
  const acctId = /<ACCTID>\s*([^<\r\n]+)/i.exec(text)?.[1];
  if (!bankId && !acctId) return null;

  const bank = bankId ? BANK_ID[bankId.padStart(3, '0')] : undefined;
  if (!bank) return null;

  // duas contas do mesmo banco (corrente + poupança) precisam de ids diferentes
  const suffix = acctId ? accountSuffix(acctId) : '';
  return {
    account: cleanAccount(suffix ? `${bank}-${suffix}` : bank),
    bank,
    from: 'ofx',
  };
}

export function guessFromContent(text: string): AccountGuess | null {
  const head = text.slice(0, 4000);
  for (const [pattern, bank] of CONTENT_BANKS) {
    if (pattern.test(head)) return { account: bank, bank, from: 'content' };
  }
  return null;
}

/**
 * Melhor palpite para uma importação de texto (CSV/OFX).
 * OFX ganha porque traz BANKID e ACCTID; o nome do arquivo só decide
 * quando o conteúdo não identifica o banco.
 */
export function guessAccount(filename: string, text: string): AccountGuess | null {
  if (/<OFX/i.test(text)) {
    return guessFromOfx(text) ?? guessFromContent(text) ?? guessFromFilename(filename);
  }
  return guessFromContent(text) ?? guessFromFilename(filename);
}
