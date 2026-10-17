# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY apps/backend ./apps/backend
RUN npm run build:api --workspace=@converter/backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@converter/backend --include-workspace-root=false --no-audit --no-fund \
    && npm cache clean --force
COPY --from=build --chown=node:node /app/apps/backend/dist/api ./apps/backend/dist/api
WORKDIR /app/apps/backend
USER node
EXPOSE 3000
CMD ["node", "dist/api/entrypoints/api.main.js"]
