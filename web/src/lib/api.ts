import type {
  AskResponse,
  BudgetItem,
  ImportResult,
  MonthSummary,
  MonthCompare,
  Range,
  Transaction,
} from '../types.ts';

/** Um mês ("2026-10") ou um período livre. */
export type Period = string | Range;

/** Mês vira ?month=; período vira ?from=&to=. */
function setPeriod(params: URLSearchParams, period?: Period): void {
  if (!period) return;
  if (typeof period === 'string') {
    params.set('month', period);
    return;
  }
  params.set('from', period.from);
  params.set('to', period.to);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();

  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `o servidor respondeu ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export function getBudgets(period?: Period, source?: string, account?: string, includeInternal?: boolean): Promise<{ month: string; from: string; to: string; items: BudgetItem[] }> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/budgets${query}`);
}
export function setBudget(category: string, month: string, limitCents: number): Promise<{ ok: boolean }> {
  return request('/api/budgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category, month, limitCents }),
  });
}
export function deleteBudget(category: string, month: string): Promise<{ ok: boolean }> {
  const params = new URLSearchParams({ category, month });
  return request(`/api/budgets?${params.toString()}`, { method: 'DELETE' });
}

export function getCompare(period?: Period, source?: string, account?: string, includeInternal?: boolean): Promise<MonthCompare> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<MonthCompare>(`/api/compare${query}`);
}
export function getSummary(period?: Period, source?: string, account?: string, includeInternal?: boolean): Promise<MonthSummary> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<MonthSummary>(`/api/summary${query}`);
}

export function ask(
  question: string,
  source?: string,
  account?: string,
  includeInternal?: boolean,
  context?: unknown,
  range?: Range,
): Promise<AskResponse> {
  return request<AskResponse>('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question,
      source: source && source !== 'all' ? source : undefined,
      account,
      includeInternal,
      context,
      from: range?.from,
      to: range?.to,
    }),
  });
}

/** Baixa um PDF gerado no servidor. */
async function downloadPdf(path: string, init: RequestInit, filename: string): Promise<void> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    let message = `o servidor respondeu ${response.status}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo nao era JSON
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Emite o PDF da prova a partir da spec exibida na tela: o servidor nao
 * replaneja, entao o documento prova exatamente o numero que o usuario viu.
 */
export function exportProof(question: string, spec: unknown): Promise<void> {
  return downloadPdf(
    '/api/export/proof',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, spec }),
    },
    'folha-de-prova.pdf',
  );
}

export function recategorize(id: string, category: string, applyAll: boolean): Promise<{ ok: boolean; id: string; category: string; applyAll: boolean; changes: number }> {
  return request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category, applyAll }),
  });
}
export function getTransactions(period: Period, limit: number, source?: string, account?: string, includeInternal?: boolean): Promise<{ month: string; items: Transaction[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  return request(`/api/transactions?${params.toString()}`);
}

export function importFile(filename: string, content: string, account?: string, base64?: string): Promise<ImportResult> {
  return request<ImportResult>('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(base64 ? { filename, base64, account } : { filename, content, account }),
  });
}

export function resetData(mode: 'imported' | 'sample' | 'all' = 'imported'): Promise<{ removed: number; sources: { sample: number; imported: number }; summary: MonthSummary }> {
  return request('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}