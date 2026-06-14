#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Vidhi Arena — AWS Deployment Script (Linux / AWS CloudShell)
# Account: 042470866347 | Region: us-east-1
# ─────────────────────────────────────────────────────────────────────────────

set -e

ECR="042470866347.dkr.ecr.us-east-1.amazonaws.com"
REGION="us-east-1"
ACCOUNT="042470866347"

echo -e "\n\033[1;36m╔══════════════════════════════════════════════╗"
echo -e "║  VIDHI ARENA — AWS DEPLOYMENT                ║"
echo -e "╚══════════════════════════════════════════════╝\033[0m\n"

# ── STEP 1: Create ECR Repositories ──────────────────────────────────────────
echo -e "\033[1;33m[1/7] Creating ECR repositories...\033[0m"

REPOS=("vidhi-engine-backend" "vidhi-engine-sandbox-manager" "vidhi-engine-frontend" "vidhi-sandbox")
for REPO in "${REPOS[@]}"; do
    if aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1; then
        echo "  · Already exists: $REPO"
    else
        aws ecr create-repository --repository-name "$REPO" --region "$REGION" >/dev/null
        echo "  ✓ Created: $REPO"
    fi
done

# ── STEP 2: ECR Login ─────────────────────────────────────────────────────────
echo -e "\n\033[1;33m[2/7] Authenticating Docker with ECR...\033[0m"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"
echo "  ✓ Docker authenticated"

# ── STEP 3: Build + Push All Images ──────────────────────────────────────────
echo -e "\n\033[1;33m[3/7] Building and pushing Docker images...\033[0m"

# Ensure we're in the right directory
cd "$(dirname "$0")"

echo "  Building backend..."
docker build -f backend/Dockerfile -t "${ECR}/vidhi-engine-backend:latest" .
docker push "${ECR}/vidhi-engine-backend:latest"
docker system prune -a -f

echo "  Building sandbox-manager..."
docker build -f sandbox-manager/Dockerfile -t "${ECR}/vidhi-engine-sandbox-manager:latest" .
docker push "${ECR}/vidhi-engine-sandbox-manager:latest"
docker system prune -a -f

echo "  Building sandbox..."
docker build -f sandbox/Dockerfile -t "${ECR}/vidhi-sandbox:latest" .
docker push "${ECR}/vidhi-sandbox:latest"
docker system prune -a -f

echo "  Building frontend..."
docker build -f vidhi_context/Dockerfile \
    --build-arg VITE_API_URL="" \
    --build-arg VITE_WS_URL="" \
    -t "${ECR}/vidhi-engine-frontend:latest" \
    vidhi_context/
docker push "${ECR}/vidhi-engine-frontend:latest"
docker system prune -a -f

echo "  ✓ All images pushed to ECR"

# ── STEP 4: Store DB Password in SSM Parameter Store ─────────────────────────
echo -e "\n\033[1;33m[4/7] Setting database password in SSM...\033[0m"
read -s -p "Enter a database password for production (will be stored securely in SSM): " DB_PASSWORD
echo ""

aws ssm put-parameter \
    --name "/vidhi/db_password" \
    --value "$DB_PASSWORD" \
    --type "SecureString" \
    --region "$REGION" \
    --overwrite >/dev/null
echo "  ✓ Password stored in SSM at /vidhi/db_password"

# ── STEP 5: Terraform Apply ───────────────────────────────────────────────────
echo -e "\n\033[1;33m[5/7] Deploying infrastructure with Terraform...\033[0m"
cd terraform
terraform init -upgrade
terraform plan -var="db_password=$DB_PASSWORD" -out=tfplan
echo ""
read -p "Review the plan above. Type 'yes' to apply: " CONFIRM
if [ "$CONFIRM" = "yes" ]; then
    terraform apply tfplan
    ALB_DNS=$(terraform output -raw alb_dns_name)
    echo "  ✓ Infrastructure deployed"
    echo -e "  \033[1;32mALB DNS: $ALB_DNS\033[0m"
else
    echo "  Skipped Terraform apply."
    ALB_DNS=""
fi
cd ..

# ── STEP 6: Final Instructions ────────────────────────────────────────────────
echo -e "\n\033[1;32m[6/7] Done! Platform is LIVE.\033[0m"
echo ""
if [ -n "$ALB_DNS" ]; then
    echo -e "  \033[1;36m🌐 Public URL: http://$ALB_DNS\033[0m"
    echo "  📊 API health: http://$ALB_DNS/api/health"
    echo ""
    echo "  Phase 1 students test locally on C++ GM (localhost:8080)"
    echo "  Phase 2 final submissions hit: http://$ALB_DNS/api/submit"
    echo "  Leaderboard live at: http://$ALB_DNS/leaderboard"
fi
echo ""
echo "Next steps after DNS propagation:"
echo "  1. Point your domain → ALB DNS (CNAME record)"
echo "  2. Request SSL cert in AWS ACM → add HTTPS listener to ALB"
echo "  3. Update frontend VITE_API_URL env var → git push → auto-redeploy"
