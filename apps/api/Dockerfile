# Build from the repository root:  docker build -f apps/api/Dockerfile -t bank-case-api .
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@bank-case/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace=@bank-case/api

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace=@bank-case/api --include-workspace-root && npm cache clean --force

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ENV NODE_ENV=production
WORKDIR /repo/apps/api
COPY --from=deps /repo/node_modules /repo/node_modules
# npm keeps version-conflicting packages (for example the AWS SDK) in the workspace's own node_modules.
COPY --from=deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./
COPY apps/api/migrations ./migrations
COPY apps/api/scripts/migrate.mjs ./scripts/migrate.mjs
# Non-root, no shell needed at runtime; the platform sets the read-only root filesystem.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
