/**
 * Empacota o servidor numa unica funcao serverless (api/index.mjs).
 *
 * A Vercel detecta `api/*.js|mjs` como funcoes depois do buildCommand. As
 * dependencias ficam externas (packages: external): a Vercel as instala e
 * rastreia com o nft, o que preserva os workers do tesseract.js.
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
});
