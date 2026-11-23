import { readFileSync } from 'node:fs';
import { openDb, insertTransactions } from '../db.ts';
import { parseCsv } from '../ingest/csv.ts';
import { normalizeMerchant, transactionId } from '../ingest/normalize.ts';
import { classify } from '../categorize/classify.ts';
import { parseSpec, canonicalSpec, type QuerySpec } from '../query/spec.ts';
import { executeSpec } from '../query/execute.ts';
import type { Planner } from '../planner/fake.ts';

interface EvalCase {
  id: string;
  question: string;
  golden: unknown;
}

const SAMPLE = new URL('../../data/sample-extrato.csv', import.meta.url);

function seedSampleDb() {
  const db = openDb(':memory:');
  const rows = parseCsv(readFileSync(SAMPLE, 'utf8')).map((row) => {
    const merchant = normalizeMerchant(row.description);
    const { category, source } = classify(row.description, merchant);
    return {
      id: transactionId('principal', row.postedAt, row.amountCents, merchant),
      account: 'principal',
      postedAt: row.postedAt,
      amountCents: row.amountCents,
      description: row.description,
      merchant,
      category,
      categorySource: source,
      fitid: null,
    };
  });
  insertTransactions(db, rows);
  return db;
}

/**
 * Mede duas coisas separadas, porque falham por motivos diferentes:
 *  - spec: o planner entendeu o que a pessoa quis perguntar?
 *  - resposta: o numero final bate com o numero correto?
 */
export async function runEval(planner: Planner, today: string): Promise<number> {
  const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as EvalCase[];
  const db = seedSampleDb();

  let specHits = 0;
  let answerHits = 0;
  const failures: string[] = [];

  console.log(`Planner: ${planner.name}`);
  console.log(`Casos:   ${cases.length}\n`);

  for (const testCase of cases) {
    const golden = parseSpec(testCase.golden) as QuerySpec;
    const planned = await planner.plan({ question: testCase.question, today });

    const specOk = canonicalSpec(planned) === canonicalSpec(golden);
    const plannedOutcome = executeSpec(db, planned);
    const goldenOutcome = executeSpec(db, golden);
    const answerOk = JSON.stringify(plannedOutcome) === JSON.stringify(goldenOutcome);

    if (specOk) specHits++;
    if (answerOk) answerHits++;

    const status = specOk && answerOk ? 'ok  ' : 'FALHA';
    console.log(`${status} ${testCase.id.padEnd(4)} ${testCase.question}`);

    if (!specOk || !answerOk) {
      failures.push(
        [
          `  esperado: ${canonicalSpec(golden)}`,
          `  obtido:   ${canonicalSpec(planned)}`,
          `  resposta: ${JSON.stringify(goldenOutcome)}`,
          `  recebido: ${JSON.stringify(plannedOutcome)}`,
        ].join('\n'),
      );
    }
  }

  if (failures.length > 0) console.log(`\n${failures.join('\n\n')}`);

  const specPct = ((specHits / cases.length) * 100).toFixed(0);
  const answerPct = ((answerHits / cases.length) * 100).toFixed(0);
  console.log(`\nPlanner:     ${specHits}/${cases.length} (${specPct}%)`);
  console.log(`Resposta:    ${answerHits}/${cases.length} (${answerPct}%)`);

  return specHits === cases.length && answerHits === cases.length ? 0 : 1;
}
