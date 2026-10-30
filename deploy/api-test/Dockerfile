FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=128
COPY package.json package-lock.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sound-rules/package.json ./packages/sound-rules/package.json
COPY packages/audio-engine/package.json ./packages/audio-engine/package.json
COPY packages/prompts/package.json ./packages/prompts/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@wanwu-v2/api --include-workspace-root=false --no-audit --no-fund
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY packages/sound-rules ./packages/sound-rules
COPY packages/audio-engine ./packages/audio-engine
COPY packages/prompts ./packages/prompts
COPY data/catalogue ./data/catalogue
USER node
CMD ["node","--test","--test-reporter=tap","--test-isolation=none","apps/api/tests/integration/auth.test.ts"]
