import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openDb, countTransactions, type Db } from './db.ts';
import { importExtrato, importPdf } from './ingest/import.ts';
import { loadEnvFile } from './env.ts';
import { compileSpec } from './query/compile.ts';
import { executeSpec } from './query/execute.ts';
import { renderAnswer } from './query/render.ts';
import { applyEntityGuard } from './query/guard.ts';
import { heuristicPlanner, type Planner } from './planner/fake.ts';
import { buildPlanner } from './planner/openai.ts';
import { runEval } from './eval/run.ts';

const DB_FILE = fileURLToPath(new URL('../data/extrato.db', import.meta.url));
const SAMPLE_FILE = fileURLToPath(new URL('../data/sample-extrato.csv', import.meta.url));

async function importRows(database: Db, file: string, account = 'principal', source: 'sample' | 'imported' = 'imported'): Promise<void> {
  const result = file.toLowerCase().endsWith('.pdf')
    ? await importPdf(database, readFileSync(file), account, source)
    : importExtrato(database, readFileSync(file, 'utf8'), account, source);

  console.log(`\nImportado: ${file}`);
  console.log(`  formato:      ${result.format.toUpperCase()}`);
  console.log(`  linhas lidas: ${result.read}`);
  console.log(`  novas:        ${result.inserted}`);
  console.log(`  duplicadas:   ${result.duplicates}\n`);

  const byCategory = database
    .prepare(
      `SELECT category, COUNT(*) AS n, SUM(amount_cents) AS total
       FROM transactions GROUP BY category ORDER BY ABS(SUM(amount_cents)) DESC`,
    )
    .all() as { category: string; n: number; total: number }[];

  for (const row of byCategory) {
    console.log(
      `  ${row.category.padEnd(16)} ${String(row.n).padStart(3)} lanc.  ${(Number(row.total) / 100).toFixed(2).padStart(10)}`,
    );
  }
  console.log();
}

async function ensureSeeded(database: Db): Promise<void> {
  if (countTransactions(database) === 0) {
    console.log('(banco vazio, importando data/sample-extrato.csv)\n');
    await importRows(database, SAMPLE_FILE, 'principal', 'sample');
  }
}

async function ask(planner: Planner, database: Db, question: string): Promise<void> {
  await ensureSeeded(database);
  const planned = await planner.plan({ question, today: new Date().toISOString().slice(0, 10) });
  const { spec } = applyEntityGuard(database, planned, question);
  const { sql, params } = compileSpec(spec);
  const answer = renderAnswer(spec, executeSpec(database, spec));

  console.log(`Pergunta: ${question}`);
  console.log(`Filtro:   ${JSON.stringify(spec)}`);
  console.log(`SQL:      ${sql.replace(/\s+/g, ' ').trim()}`);
  console.log(`Params:   ${JSON.stringify(params)}`);
  console.log(`\n${answer}\n`);
}

const DEMO_QUESTIONS = [
  'quanto gastei em outubro',
  'para onde foi meu dinheiro em outubro',
  'quanto gastei com iFood em outubro',
  'quantas vezes pedi iFood em outubro',
  'quais foram meus maiores gastos em outubro',
];

async function main(): Promise<number> {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  const [command, ...args] = process.argv.slice(2);
  const planner: Planner = buildPlanner();
  const database = openDb(DB_FILE);

  switch (command) {
    case 'import': {
      const file = args[0];
      if (!file) throw new Error('uso: npm run import -- <arquivo.csv|arquivo.ofx|arquivo.pdf>');
      await importRows(database, file);
      return 0;
    }

    case 'ask': {
      const question = args.join(' ').trim();
      if (!question) throw new Error('uso: npm run ask -- "quanto gastei em outubro"');
      await ask(planner, database, question);
      return 0;
    }

    case 'demo': {
      await ensureSeeded(database);
      for (const question of DEMO_QUESTIONS) {
        await ask(planner, database, question);
      }
      return 0;
    }

    case 'eval': {
      // por padrao mede o baseline heuristico: deterministico e sem rede.
      // use "npm run eval -- --llm" para medir o planner configurado.
      const withLlm = args.includes('--llm');
      return runEval(withLlm ? buildPlanner() : heuristicPlanner, new Date().toISOString().slice(0, 10));
    }

    default:
      console.log(`uso: node --experimental-strip-types src/cli.ts <comando>

  import <arquivo>   importa CSV ou OFX
  ask "<pergunta>"   responde uma pergunta
  demo               roda as perguntas de demonstracao
  eval               mede planner e resposta contra casos conhecidos

variavel de ambiente:
  PLANNER=fake|openai   (padrao: fake, roda offline)`);
      return command ? 1 : 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`\nerro: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
