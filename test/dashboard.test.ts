import test from 'node:test';
import assert from 'node:assert/strict';

import { loadDashboard, type DashboardCallbacks, type DashboardData } from '../web/src/lib/dashboardLoad.ts';
import type { ManualSummary, MonthSummary } from '../web/src/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fixture<T>(label: string): T {
  return { label } as unknown as T;
}

function recorder() {
  const events: string[] = [];
  const results: DashboardData[] = [];
  const errors: string[] = [];
  const callbacks: DashboardCallbacks = {
    start: () => events.push('start'),
    success: (data) => {
      events.push('success');
      results.push(data);
    },
    failure: (message) => {
      events.push('failure');
      errors.push(message);
    },
    finish: () => events.push('finish'),
  };
  return { events, results, errors, callbacks };
}

test('dashboard: so publica os painéis quando extrato e manual chegam', async () => {
  const rec = recorder();
  const extrato = deferred<MonthSummary>();
  const manual = deferred<ManualSummary>();
  const expectedExtrato = fixture<MonthSummary>('extrato');
  const expectedManual = fixture<ManualSummary>('manual');

  loadDashboard({ extrato: () => extrato.promise, manual: () => manual.promise }, rec.callbacks);
  assert.deepEqual(rec.events, ['start']);

  manual.resolve(expectedManual);
  await flush();
  assert.deepEqual(rec.events, ['start']);

  extrato.resolve(expectedExtrato);
  await flush();
  assert.deepEqual(rec.events, ['start', 'success', 'finish']);
  assert.deepEqual(rec.results, [{ extrato: expectedExtrato, manual: expectedManual }]);
});

test('dashboard: cancelar evita piscada de loading quando a req antiga termina', async () => {
  const rec = recorder();
  const antiga = deferred<MonthSummary>();
  const cancel = loadDashboard({ extrato: () => antiga.promise }, rec.callbacks);
  assert.deepEqual(rec.events, ['start']);

  cancel();
  antiga.resolve(fixture<MonthSummary>('antigo'));
  await flush();
  assert.deepEqual(rec.events, ['start']);
});

test('dashboard: resposta antiga nao sobrescreve a mais recente', async () => {
  const rec = recorder();
  const antiga = deferred<MonthSummary>();
  const nova = deferred<MonthSummary>();
  const expected = fixture<MonthSummary>('novo');

  const cancel = loadDashboard({ extrato: () => antiga.promise }, rec.callbacks);
  cancel();
  loadDashboard({ extrato: () => nova.promise }, rec.callbacks);

  nova.resolve(expected);
  await flush();
  antiga.resolve(fixture<MonthSummary>('antigo'));
  await flush();

  assert.deepEqual(rec.events, ['start', 'start', 'success', 'finish']);
  assert.equal(rec.results.length, 1);
  assert.equal(rec.results[0]!.extrato, expected);
});

test('dashboard: erro de req cancelada nao aparece', async () => {
  const rec = recorder();
  const antiga = deferred<MonthSummary>();
  const nova = deferred<MonthSummary>();

  const cancel = loadDashboard({ extrato: () => antiga.promise }, rec.callbacks);
  cancel();
  loadDashboard({ extrato: () => nova.promise }, rec.callbacks);

  antiga.reject(new Error('antigo'));
  nova.reject(new Error('novo'));
  await flush();

  assert.deepEqual(rec.events, ['start', 'start', 'failure', 'finish']);
  assert.deepEqual(rec.errors, ['novo']);
});
