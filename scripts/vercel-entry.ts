/**
 * Entrada da funcao serverless da Vercel. O build empacota este arquivo em
 * `api/index.mjs`; o handler e o mesmo de `npm start`.
 */
export { handler as default } from '../src/server.ts';
