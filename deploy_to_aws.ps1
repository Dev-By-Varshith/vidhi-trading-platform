#!/usr/bin/env pwsh
# ─────────────────────────────────────────────────────────────────────────────
# Vidhi Arena — AWS Deployment Script
# Account: 042470866347 | Region: us-east-1
#
# Run this ONCE from your local machine (Windows PowerShell).
# After this, all future deploys are automatic via GitHub Actions on git push.
# ─────────────────────────────────────────────────────────────────────────────

$ECR     = "042470866347.dkr.ecr.us-east-1.amazonaws.com"
$REGION  = "us-east-1"
$Account = "042470866347"

Write-Host "`n╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  VIDHI ARENA — AWS DEPLOYMENT                ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# ── STEP 1: Create ECR Repositories ──────────────────────────────────────────
Write-Host "[1/7] Creating ECR repositories..." -ForegroundColor Yellow

foreach ($repo in @("vidhi-backend","vidhi-engine-sandbox-manager","vidhi-engine-frontend","vidhi-sandbox")) {
    $exists = aws ecr describe-repositories --repository-names $repo --region $REGION 2>$null
    if ($LASTEXITCODE -ne 0) {
        aws ecr create-repository --repository-name $repo --region $REGION | Out-Null
        Write-Host "  ✓ Created: $repo"
    } else {
        Write-Host "  · Already exists: $repo"
    }
}

# ── STEP 2: ECR Login ─────────────────────────────────────────────────────────
Write-Host "`n[2/7] Authenticating Docker with ECR..." -ForegroundColor Yellow
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR
if ($LASTEXITCODE -ne 0) { Write-Host "ECR login failed. Check AWS credentials." -ForegroundColor Red; exit 1 }
Write-Host "  ✓ Docker authenticated"

# ── STEP 3: Build + Push All Images ──────────────────────────────────────────
Write-Host "`n[3/7] Building and pushing Docker images..." -ForegroundColor Yellow
Set-Location (Split-Path $PSScriptRoot)

# Backend (includes C++ Game Master compiled inside)
Write-Host "  Building backend..."
docker build -f backend/Dockerfile -t "${ECR}/vidhi-backend:latest" .
docker push "${ECR}/vidhi-backend:latest"

# Sandbox Manager
Write-Host "  Building sandbox-manager..."
docker build -f sandbox-manager/Dockerfile -t "${ECR}/vidhi-engine-sandbox-manager:latest" .
docker push "${ECR}/vidhi-engine-sandbox-manager:latest"

# Contestant Sandbox
Write-Host "  Building sandbox..."
docker build -f sandbox/Dockerfile -t "${ECR}/vidhi-sandbox:latest" .
docker push "${ECR}/vidhi-sandbox:latest"

# Frontend
Write-Host "  Building frontend..."
docker build -f vidhi_context/Dockerfile `
    --build-arg VITE_API_URL="" `
    --build-arg VITE_WS_URL="" `
    -t "${ECR}/vidhi-engine-frontend:latest" `
    vidhi_context/
docker push "${ECR}/vidhi-engine-frontend:latest"

Write-Host "  ✓ All images pushed to ECR"

# ── STEP 4: Store DB Password in SSM Parameter Store ─────────────────────────
Write-Host "`n[4/7] Setting database password in SSM..." -ForegroundColor Yellow
$dbPassword = Read-Host "Enter a database password for production (will be stored in SSM)" -AsSecureString
$dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))

aws ssm put-parameter `
    --name "/vidhi/db_password" `
    --value $dbPasswordPlain `
    --type "SecureString" `
    --region $REGION `
    --overwrite | Out-Null
Write-Host "  ✓ Password stored in SSM at /vidhi/db_password"

# ── STEP 5: Terraform Apply ───────────────────────────────────────────────────
Write-Host "`n[5/7] Deploying infrastructure with Terraform..." -ForegroundColor Yellow
Set-Location terraform
terraform init -upgrade
terraform plan -var="db_password=$dbPasswordPlain" -out=tfplan
Write-Host ""
$confirm = Read-Host "Review the plan above. Type 'yes' to apply"
if ($confirm -eq "yes") {
    terraform apply tfplan
    $ALB_DNS = terraform output -raw alb_dns_name
    Write-Host "  ✓ Infrastructure deployed"
    Write-Host "  ALB DNS: $ALB_DNS" -ForegroundColor Green
} else {
    Write-Host "  Skipped Terraform apply."
}
Set-Location ..

# ── STEP 6: Set GitHub Secrets ────────────────────────────────────────────────
Write-Host "`n[6/7] GitHub Actions secrets needed..." -ForegroundColor Yellow
Write-Host "  Go to: https://github.com/YOUR_REPO/settings/secrets/actions"
Write-Host "  Add these secrets:"
Write-Host "    AWS_ACCESS_KEY_ID     = (your IAM access key)"
Write-Host "    AWS_SECRET_ACCESS_KEY = (your IAM secret key)"
Write-Host ""
Write-Host "  After adding, every 'git push origin main' auto-deploys. ✓"

# ── STEP 7: Final Instructions ────────────────────────────────────────────────
Write-Host "`n[7/7] Done! Platform is LIVE." -ForegroundColor Green
Write-Host ""
if ($ALB_DNS) {
    Write-Host "  🌐 Public URL: http://$ALB_DNS" -ForegroundColor Cyan
    Write-Host "  📊 API health: http://$ALB_DNS/api/health"
    Write-Host ""
    Write-Host "  Phase 1 students test locally on C++ GM (localhost:8080)"
    Write-Host "  Phase 2 final submissions hit: http://$ALB_DNS/api/submit"
    Write-Host "  Leaderboard live at: http://$ALB_DNS/leaderboard"
}
Write-Host ""
Write-Host "Next steps after DNS:"
Write-Host "  1. Point your domain → ALB DNS (CNAME record)"
Write-Host "  2. Request SSL cert in AWS ACM → add HTTPS listener to ALB"
Write-Host "  3. Update frontend VITE_API_URL env var → git push → auto-redeploy"
