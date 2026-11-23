import { readFileSync } from 'node:fs';

/** Carrega .env sem dependencia (arquivo opcional, variavel ja definida vence). */
export function loadEnvFile(path: string): void {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (match?.[1] && !process.env[match[1]]) process.env[match[1]] = match[2] ?? '';
    }
  } catch {
    // .env e opcional
  }
}
