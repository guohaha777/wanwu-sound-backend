# Prototype gate only. This is not a production API/worker deployment.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_OPTIONS=--max-old-space-size=128 \
    WANWU_CONTAINER_TEST=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates
# Browser tooling is independent of application source and the workspace lockfile.
# The renderer uses channel=chromium (new headless); the separate shell is unused.
RUN npx --yes --package=playwright@1.64.1 playwright install --with-deps --no-shell chromium
COPY package.json package-lock.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sound-rules/package.json ./packages/sound-rules/package.json
COPY packages/audio-engine/package.json ./packages/audio-engine/package.json
COPY packages/prompts/package.json ./packages/prompts/package.json
COPY packages/music-features/package.json ./packages/music-features/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && mkdir -p /app/artifacts \
    && chown node:node /app/artifacts
COPY apps ./apps
COPY packages ./packages
COPY data/catalogue ./data/catalogue
COPY deploy/media-prototype ./deploy/media-prototype
COPY scripts ./scripts
USER node
CMD ["node", "apps/worker/src/container-proof.ts"]
