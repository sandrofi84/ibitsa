# The VS Code integration suites in Linux under xvfb, as CI runs them (#39), so they can run locally
# without VS Code windows taking focus. Used by scripts/test-integration-docker.mjs.
FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth git ca-certificates \
    libnss3 libgtk-3-0 libxss1 libasound2 libgbm1 libxkbfile1 libsecret-1-0 libdrm2 \
    libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  npm_config_store_dir=/pnpm-store
RUN corepack enable \
  && mkdir -p /work/packages/extension/.vscode-test /pnpm-store \
  && chown -R node:node /work /pnpm-store

# Electron refuses to run as root without --no-sandbox; the image's own user avoids that.
USER node
WORKDIR /work
