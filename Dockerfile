# syntax=docker/dockerfile:1

# A UI é estática: o build (vite + devDependencies) morre nesta etapa.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# banco fora da imagem: este caminho é o volume persistente
ENV NODE_ENV=production \
    PORT=8787 \
    EXTRATO_DB=/data/extrato.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/web/dist ./web/dist
COPY src ./src
COPY tsconfig.json ./
COPY data/labels.json ./data/labels.json
COPY data/sample-extrato.csv ./data/sample-extrato.csv

# OCR: traineddata baixado no build (o deploy nao gasta o primeiro import
# baixando modelo) e cache em diretorio gravavel pelo usuario node.
ENV OCR_CACHE_DIR=/app/data/ocr
RUN mkdir -p /app/data/ocr /data \
 && node -e "const {writeFileSync}=require('node:fs');const {gunzipSync}=require('node:zlib');fetch('https://tessdata.projectnaptha.com/4.0.0_fast/por.traineddata.gz').then(r=>{if(!r.ok)throw new Error('traineddata '+r.status);return r.arrayBuffer()}).then(b=>writeFileSync('/app/data/ocr/por.traineddata',gunzipSync(Buffer.from(b))))" \
 && chown -R node:node /app/data/ocr /data
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "--no-warnings", "src/server.ts"]
