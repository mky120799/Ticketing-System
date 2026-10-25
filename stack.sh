#!/usr/bin/env bash
#
# One command to run and stop the whole local stack (Docker Compose).
#
#   ./stack.sh start            start everything (builds the images the first time)
#   ./stack.sh stop             stop everything; all data is kept
#   ./stack.sh rebuild [svc]    rebuild after you change code (all apps, or one: api, web, portal)
#   ./stack.sh restart [svc]    restart without rebuilding
#   ./stack.sh status           what is running
#   ./stack.sh logs [svc]       follow the logs (Ctrl+C to stop following)
#   ./stack.sh down             remove the containers; data is kept, but Keycloak starts fresh
#   ./stack.sh reset            remove containers AND data (asks first)
#
# Why "--profile app" everywhere: in docker-compose.yml the api, web, portal and migrate services are in the "app"
# profile, so a plain `docker compose up` would start only the infrastructure and skip the application.

set -euo pipefail
cd "$(dirname "$0")" # run from the project folder wherever the script is called from

compose() { docker compose --profile app "$@"; }

# Waits until a URL answers, so "start" only says "ready" when you can actually sign in.
wait_for() {
  local name=$1 url=$2
  printf 'Waiting for %s ' "$name"
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo 'ready'; return 0; fi
    printf '.'; sleep 2
  done
  echo " not answering yet (check: ./stack.sh logs $3)"
}

print_urls() {
  cat <<'EOF'

  Staff console    http://localhost:5173   (local-supervisor, local-case-agent, local-auditor, local-admin)
  Customer portal  http://localhost:5174   (local-customer)
  Keycloak admin   http://localhost:8080/admin   (local-admin / local-admin-change-me)
  API              http://localhost:3000/v1
  App password     local-dev-only-change-me
EOF
}

ready() {
  wait_for 'Keycloak' 'http://localhost:8080/realms/bank-case-dev' keycloak
  wait_for 'API' 'http://localhost:3000/v1/health/ready' api
  wait_for 'staff console' 'http://localhost:5173' web
  print_urls
}

case "${1:-help}" in
  start)
    # Starts stopped containers as they were; builds images only if they do not exist yet.
    compose up -d
    ready
    ;;
  stop)
    # Like closing a laptop lid: containers pause, nothing is deleted (tickets, uploads, Keycloak users and OTP stay).
    compose stop
    ;;
  rebuild)
    # Code is copied into the images at build time, so code changes need a rebuild. Only containers whose image
    # changed are recreated; the migrate step runs first, so new database migrations are applied too.
    shift
    compose up -d --build "$@"
    ready
    ;;
  restart)
    shift
    compose restart "$@"
    ;;
  status)
    compose ps
    ;;
  logs)
    shift
    compose logs -f --tail=100 "$@"
    ;;
  down)
    # Removes the containers. Database and uploaded files are kept (they live in volumes), but Keycloak keeps its data
    # inside its container: users get new IDs and any OTP/MFA you set up is gone. Use "stop" to avoid that.
    compose down
    ;;
  reset)
    read -r -p 'This deletes ALL local data (tickets, audit trail, uploads). Type "yes" to continue: ' answer
    [ "$answer" = 'yes' ] || { echo 'Cancelled.'; exit 1; }
    compose down -v
    ;;
  *)
    sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
