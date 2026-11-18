/**
 * Empacota o servidor numa unica funcao serverless (api/index.mjs).
 *
 * As dependencias ficam externas (packages: external): a Vercel as instala e
 * rastreia com o nft, o que preserva os workers do tesseract.js.
 *
 * O bundle gerado e versionado no git de proposito: a Vercel valida o bloco
 * `functions` do vercel.json ANTES de rodar o buildCommand, e um padrao que
 * aponta para um arquivo inexistente quebra o deploy (`unused_function`).
 * O buildCommand regenera o arquivo, entao o commit e so o ponto de partida.
 */
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('api', { recursive: true });

await build({
  entryPoints: ['scripts/vercel-entry.ts'],
  outfile: 'api/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: '// ARQUIVO GERADO por scripts/build-api.mjs (npm run build:api). Nao edite a mao.',
  },
});
