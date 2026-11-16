/**
 * Vocabulario do dominio. Fonte unica para regras, planner heuristico
 * e prompt do planner via LLM (evita tres listas divergentes).
 */

export const CATEGORIES = [
  'Alimentação',
  'Assinaturas',
  'Bem-estar',
  'Compras',
  'Lazer',
  'Moradia',
  'Renda',
  'Saúde',
  'Supermercado',
  'Tarifas',
  'Transferências',
  'Transporte',
  'Outros',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Marcas aparecem como nome proprio no extrato: filtro por estabelecimento, nao por categoria. */
export const BRANDS = [
  'ifood',
  'uber',
  'netflix',
  'spotify',
  'amazon',
  'shopee',
  'carrefour',
  'assai',
  'pao de acucar',
  'droga raia',
  'pacheco',
  'smart fit',
  'enel',
  'sabesp',
  'shell',
  'ipiranga',
  'cinemark',
  'outback',
  'padaria bella',
  'mercado livre',
];

/** Palavra do dia a dia -> categoria. Usado quando a pergunta nao cita uma marca. */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Alimentação': ['alimentacao', 'comida', 'restaurante', 'lanche', 'delivery', 'pizza', 'padaria', 'cafe'],
  Assinaturas: ['assinatura', 'streaming', 'netflix', 'spotify'],
  'Bem-estar': ['academia', 'bem estar', 'exercicio', 'suplemento'],
  Compras: ['compras', 'shopping', 'loja', 'eletronico', 'roupa'],
  Lazer: ['lazer', 'cinema', 'bar', 'viagem', 'ingresso', 'show'],
  Moradia: ['moradia', 'aluguel', 'casa', 'conta de luz', 'luz', 'agua', 'internet', 'condominio'],
  Renda: ['renda', 'salario', 'receita', 'provento'],
  Saúde: ['saude', 'farmacia', 'remedio', 'medico', 'consulta', 'dentista'],
  Supermercado: ['supermercado', 'mercado', 'feira', 'hortifruti', 'acougue'],
  Tarifas: ['tarifa', 'taxa', 'juros', 'banco', 'iof'],
  'Transferências': ['transferencia', 'pix', 'ted'],
  Transporte: ['transporte', 'uber', 'taxi', 'onibus', 'metro', 'combustivel', 'gasolina', 'posto', 'estacionamento'],
};

/** Nome de exibição; quem casa pergunta com mês compara via stripAccents. */
export const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Rótulo de três letras (OUT), derivado do nome — não é uma segunda lista. */
export const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3).toUpperCase());
