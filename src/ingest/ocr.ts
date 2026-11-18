import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWorker } from 'tesseract.js';

// um extrato de imagem tem poucas paginas: nao adianta reconhecer 30 imagens
// de um PDF qualquer nem uma imagem gigante que so gasta CPU
const MAX_OCR_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const OCR_TIMEOUT_MS = 60_000;

/**
 * Extrato que e so imagem (a Caixa exporta assim: um print dentro do PDF) nao
 * tem camada de texto, entao o unico caminho e OCR. O idioma `por` baixa o
 * traineddata na primeira execucao e fica em data/ocr.
 *
 * OCR roda fora do processo principal (worker) e pode demorar: os limites
 * abaixo evitam que um arquivo grande ou ilegivel prenda o servidor.
 */
export async function ocrImages(images: Uint8Array[]): Promise<string> {
  const usable = images
    .filter((image) => image.length > 0 && image.length <= MAX_IMAGE_BYTES)
    .slice(0, MAX_OCR_IMAGES);
  if (usable.length === 0) return '';

  // na Vercel so /tmp e gravavel; localmente o cache fica junto do projeto
  const base = process.env.VERCEL === '1' ? '/tmp' : process.cwd();
  const cachePath = process.env.OCR_CACHE_DIR ?? join(base, 'data', 'ocr');
  mkdirSync(cachePath, { recursive: true });

  const worker = await createWorker('por', 1, { cachePath });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const recognize = (async () => {
      const parts: string[] = [];
      for (const image of usable) {
        const { data } = await worker.recognize(Buffer.from(image));
        parts.push(data.text);
      }
      return parts.join('\n');
    })();

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('OCR demorou mais de 60 s: imagem ilegivel ou PDF grande demais')),
        OCR_TIMEOUT_MS,
      );
    });

    return await Promise.race([recognize, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
