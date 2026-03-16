#!/bin/bash
# deploy.sh — Deploy Filament agent team to Google Cloud Run
#
# Usage:
#   ./deploy.sh              # Deploy all 4 services
#   ./deploy.sh orchestrator # Deploy only the orchestrator
#   ./deploy.sh screen       # Deploy only the screen analyst
#
# Prerequisites:
#   - gcloud CLI authenticated: gcloud auth login
#   - Docker configured: gcloud auth configure-docker us-central1-docker.pkg.dev
#   - Artifact Registry repo created (see below)

set -euo pipefail

# ── Config ──
PROJECT="${GOOGLE_CLOUD_PROJECT:-gcloud-hackathon-9er4rb4nr0k7a}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
REPO="filament"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"

# Service definitions: name → SERVICE_TARGET env var
declare -A SERVICES=(
  [filament-orchestrator]="orchestrator"
  [filament-screen-analyst]="screen"
  [filament-workspace-agent]="workspace"
  [filament-nudge-composer]="nudge"
)

# ── Ensure Artifact Registry repo exists ──
echo "==> Ensuring Artifact Registry repo '${REPO}' exists..."
gcloud artifacts repositories describe "${REPO}" \
  --project="${PROJECT}" --location="${REGION}" 2>/dev/null || \
gcloud artifacts repositories create "${REPO}" \
  --project="${PROJECT}" --location="${REGION}" \
  --repository-format=docker \
  --description="Filament agent images"

# ── Load secrets from .env ──
if [ -f .env ]; then
  echo "==> Loading .env for secret values..."
  set -a
  source .env
  set +a
fi

# ── Filter to requested services ──
TARGET="${1:-all}"
DEPLOY_LIST=()
if [ "$TARGET" = "all" ]; then
  DEPLOY_LIST=("filament-screen-analyst" "filament-workspace-agent" "filament-nudge-composer" "filament-orchestrator")
else
  for svc in "${!SERVICES[@]}"; do
    if [[ "$svc" == *"$TARGET"* ]] || [[ "${SERVICES[$svc]}" == "$TARGET" ]]; then
      DEPLOY_LIST+=("$svc")
    fi
  done
fi

if [ ${#DEPLOY_LIST[@]} -eq 0 ]; then
  echo "Error: No matching service for '${TARGET}'"
  echo "Available: orchestrator, screen, workspace, nudge, all"
  exit 1
fi

echo "==> Deploying: ${DEPLOY_LIST[*]}"

# ── Build and deploy each service ──
for SERVICE_NAME in "${DEPLOY_LIST[@]}"; do
  SERVICE_TARGET="${SERVICES[$SERVICE_NAME]}"
  IMAGE="${REGISTRY}/${SERVICE_NAME}:latest"

  echo ""
  echo "━━━ Building ${SERVICE_NAME} (target=${SERVICE_TARGET}) ━━━"
  gcloud builds submit . \
    --project="${PROJECT}" \
    --tag="${IMAGE}" \
    --timeout=600

  echo "━━━ Deploying ${SERVICE_NAME} to Cloud Run ━━━"

  # Base deploy args
  DEPLOY_ARGS=(
    --image="${IMAGE}"
    --project="${PROJECT}"
    --region="${REGION}"
    --platform=managed
    --allow-unauthenticated
    --port=8080
    --memory=1Gi
    --cpu=1
    --min-instances=1
    --max-instances=5
    --timeout=300
    --set-env-vars="SERVICE_TARGET=${SERVICE_TARGET}"
    --set-env-vars="GOOGLE_API_KEY=${GOOGLE_API_KEY:-}"
    --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=${GOOGLE_GENAI_USE_VERTEXAI:-FALSE}"
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT}"
  )

  # Orchestrator needs agent service URLs (set after first deploy, then redeploy)
  if [ "$SERVICE_TARGET" = "orchestrator" ]; then
    DEPLOY_ARGS+=(
      --set-env-vars="AGENT_MODE=remote"
      --set-env-vars="SCREEN_ANALYST_URL=${SCREEN_ANALYST_URL:-}"
      --set-env-vars="WORKSPACE_AGENT_URL=${WORKSPACE_AGENT_URL:-}"
      --set-env-vars="NUDGE_COMPOSER_URL=${NUDGE_COMPOSER_URL:-}"
      --set-env-vars="GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID:-}"
      --set-env-vars="GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET:-}"
    )
  fi

  gcloud run deploy "${SERVICE_NAME}" "${DEPLOY_ARGS[@]}"

  # Capture the URL
  URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT}" --region="${REGION}" \
    --format="value(status.url)")
  echo "✓ ${SERVICE_NAME} deployed: ${URL}"

  # Export URLs for orchestrator env
  case "$SERVICE_TARGET" in
    screen)    export SCREEN_ANALYST_URL="${URL}" ;;
    workspace) export WORKSPACE_AGENT_URL="${URL}" ;;
    nudge)     export NUDGE_COMPOSER_URL="${URL}" ;;
  esac
done

# ── Print summary ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Filament Agent Team — Deployment Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

for SERVICE_NAME in "${DEPLOY_LIST[@]}"; do
  URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT}" --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "(not deployed)")
  echo "  ${SERVICE_NAME}: ${URL}"
done

echo ""
echo "If this is first deploy, update orchestrator with service URLs:"
echo "  export SCREEN_ANALYST_URL=<screen-url>"
echo "  export WORKSPACE_AGENT_URL=<workspace-url>"
echo "  export NUDGE_COMPOSER_URL=<nudge-url>"
echo "  ./deploy.sh orchestrator"
