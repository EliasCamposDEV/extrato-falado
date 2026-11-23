import type {
  AskResponse,
  BudgetItem,
  ImportResult,
  ManualEntry,
  ManualSummary,
  MonthSummary,
  MonthCompare,
  Range,
  RecurringTemplate,
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

/** `ephemeral` sinaliza uma demo com banco temporário, sem persistência garantida. */
export function getHealth(): Promise<{
  ok: boolean;
  ephemeral?: boolean;
  limits?: { maxUploadBytes: number | null };
  /** true na demo publica: o extrato nao pode ser importado nem editado */
  readOnly?: boolean;
  publicDemo?: boolean;
}> {
  return request('/api/health');
}

export interface Consent {
  privacy: boolean;
  over18: boolean;
  shareNotice: boolean;
  llm: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface ConsentStatus {
  required: boolean;
  privacyUrl: string;
  retentionDays: number;
  consent: Consent | null;
}

export interface MyData {
  consent: Consent | null;
  manualEntries: unknown[];
  recurringTemplates: unknown[];
  budgets: unknown[];
}

export function getConsent(): Promise<ConsentStatus> {
  return request('/api/consent');
}

export function acceptConsent(llm: boolean): Promise<{ ok: boolean; consent: Consent }> {
  return request('/api/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ privacy: true, over18: true, shareNotice: true, llm }),
  });
}

export function revokeConsent(): Promise<{ ok: boolean; revoked: boolean }> {
  return request('/api/consent', { method: 'DELETE' });
}

export function getMyData(): Promise<MyData> {
  return request('/api/me');
}

export function deleteMyData(): Promise<{ ok: boolean; removed: Record<string, number> }> {
  return request('/api/me', { method: 'DELETE' });
}

export function getBudgets(period?: Period, source?: string, account?: string, includeInternal?: boolean, includeManual?: boolean): Promise<{ month: string; from: string; to: string; items: BudgetItem[] }> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  if (includeManual) params.set('includeManual', '1');
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

export function getCompare(period?: Period, source?: string, account?: string, includeInternal?: boolean, includeManual?: boolean): Promise<MonthCompare> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  if (includeManual) params.set('includeManual', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<MonthCompare>(`/api/compare${query}`);
}
export function getSummary(period?: Period, source?: string, account?: string, includeInternal?: boolean, includeManual?: boolean): Promise<MonthSummary> {
  const params = new URLSearchParams();
  setPeriod(params, period);
  if (source && source !== 'all') params.set('source', source);
  if (account) params.set('account', account);
  if (includeInternal) params.set('includeInternal', '1');
  if (includeManual) params.set('includeManual', '1');
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

export function importFile(
  filename: string,
  content: string,
  account?: string,
  base64?: string,
  invoiceMonth?: string,
): Promise<ImportResult> {
  return request<ImportResult>('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, ...(base64 ? { base64 } : { content }), account, invoiceMonth }),
  });
}

export function patchTransaction(id: string, payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  return request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function explainTransaction(id: string): Promise<{ id: string; category: string; source: string; reason: string }> {
  return request(`/api/transactions/${encodeURIComponent(id)}/explain`);
}

export function resetData(mode: 'imported' | 'sample' | 'all' = 'imported'): Promise<{ removed: number; sources: { sample: number; imported: number }; summary: MonthSummary }> {
  return request('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export function getManualSummary(month?: string): Promise<ManualSummary> {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<ManualSummary>(`/api/manual/summary${query}`);
}

export function getManualEntries(filters?: { from?: string; to?: string; month?: string; category?: string; tag?: string; direction?: 'in' | 'out'; account?: string; limit?: number; offset?: number }): Promise<{ items: ManualEntry[] }> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.month) params.set('month', filters.month);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.tag) params.set('tag', filters.tag);
  if (filters?.direction) params.set('direction', filters.direction);
  if (filters?.account) params.set('account', filters.account);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<{ items: ManualEntry[] }>(`/api/manual${query}`);
}
export function createManualEntry(payload: { amount: number; direction?: 'in' | 'out'; postedAt: string; category: string; description?: string; tags?: string[]; account?: string; recurringTemplateId?: string | null }): Promise<ManualEntry> {
  return request<ManualEntry>('/api/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function updateManualEntry(id: string, payload: Partial<Omit<ManualEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ManualEntry> {
  return request<ManualEntry>(`/api/manual/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function deleteManualEntry(id: string): Promise<void> {
  return request<void>(`/api/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getRecurringTemplates(activeOnly = false): Promise<{ items: RecurringTemplate[] }> {
  const params = new URLSearchParams();
  if (activeOnly) params.set('active', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<{ items: RecurringTemplate[] }>(`/api/recurring${query}`);
}
export function createRecurringTemplate(payload: Omit<RecurringTemplate, 'id' | 'createdAt'>): Promise<RecurringTemplate> {
  return request<RecurringTemplate>('/api/recurring', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function updateRecurringTemplate(id: string, payload: Partial<Omit<RecurringTemplate, 'id' | 'createdAt'>>): Promise<RecurringTemplate> {
  return request<RecurringTemplate>(`/api/recurring/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export function deleteRecurringTemplate(id: string): Promise<void> {
  return request<void>(`/api/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' });
}