# Build from the repository root:  docker build -f apps/portal/Dockerfile -t bank-case-portal .
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/
RUN npm ci --workspace=@bank-case/portal --include-workspace-root
COPY apps/portal apps/portal
RUN npm run build --workspace=@bank-case/portal

FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
COPY apps/portal/nginx/default.conf.template apps/portal/nginx/security-headers.inc.template /etc/nginx/templates/
COPY apps/portal/nginx/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
ENV CSP_CONNECT_SRC="'self'"
EXPOSE 8080
