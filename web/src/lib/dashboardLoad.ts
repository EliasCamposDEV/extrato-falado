import type { ManualSummary, MonthSummary } from '../types.ts';

/**
 * Controle de carregamento do dashboard, separado do React para poder ser testado.
 * A ordem das respostas nao define o estado: so a ultima chamada ainda ativa aplica dados.
 */
export interface DashboardData {
  extrato?: MonthSummary;
  manual?: ManualSummary;
}

export interface DashboardLoaders {
  extrato?: () => Promise<MonthSummary>;
  manual?: () => Promise<ManualSummary>;
}

export interface DashboardCallbacks {
  start: () => void;
  success: (data: DashboardData) => void;
  failure: (message: string) => void;
  finish: () => void;
}

export function loadDashboard(loaders: DashboardLoaders, callbacks: DashboardCallbacks): () => void {
  let cancelled = false;
  callbacks.start();

  const pending: { key: keyof DashboardLoaders; run: () => Promise<unknown> }[] = [];
  if (loaders.extrato) pending.push({ key: 'extrato', run: loaders.extrato });
  if (loaders.manual) pending.push({ key: 'manual', run: loaders.manual });

  Promise.all(pending.map(({ run }) => run()))
    .then((values) => {
      if (cancelled) return;
      const data: DashboardData = {};
      pending.forEach(({ key }, index) => {
        if (key === 'extrato') data.extrato = values[index] as MonthSummary;
        else data.manual = values[index] as ManualSummary;
      });
      callbacks.success(data);
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      callbacks.failure(error instanceof Error ? error.message : 'Erro');
    })
    .finally(() => {
      if (cancelled) return;
      callbacks.finish();
    });

  return () => {
    cancelled = true;
  };
}
