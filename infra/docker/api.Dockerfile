# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm install --prefix /opt/flux-npm --no-save --ignore-scripts --no-audit --no-fund "$(node -p 'require("./package.json").packageManager')"
RUN node /opt/flux-npm/node_modules/npm/bin/npm-cli.js ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY apps/backend ./apps/backend
RUN node /opt/flux-npm/node_modules/npm/bin/npm-cli.js run build:api --workspace=@converter/backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /opt/flux-npm /opt/flux-npm
RUN node /opt/flux-npm/node_modules/npm/bin/npm-cli.js ci --omit=dev --workspace=@converter/backend --include-workspace-root=false --no-audit --no-fund \
    && node /opt/flux-npm/node_modules/npm/bin/npm-cli.js cache clean --force
COPY --from=build --chown=node:node /app/apps/backend/dist/api ./apps/backend/dist/api
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
CMD ["node", "dist/api/entrypoints/api.main.js"]
