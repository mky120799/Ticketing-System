# Build from the repository root:  docker build -f apps/web/Dockerfile -t bank-case-web .
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@bank-case/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build --workspace=@bank-case/web

FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf.template apps/web/nginx/security-headers.inc.template /etc/nginx/templates/
COPY apps/web/nginx/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
ENV CSP_CONNECT_SRC="'self'"
EXPOSE 8080
