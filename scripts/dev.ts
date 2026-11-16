import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

const children: ChildProcess[] = [
  spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, [vite, '--config', 'web/vite.config.ts'], { stdio: 'inherit' }),
];

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });
}
