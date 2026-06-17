# Apply Terraform bypassing the docker steps so you don't need Docker running!
Write-Host ""
Write-Host "[1/2] Setting database password in SSM..." -ForegroundColor Yellow
$dbPassword = Read-Host "Enter your database password again" -AsSecureString
$dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))

Write-Host ""
Write-Host "[2/2] Applying AWS Networking Fixes..." -ForegroundColor Yellow
Set-Location terraform
terraform init -upgrade
terraform apply -auto-approve -var="db_password=$dbPasswordPlain"
Set-Location ..

Write-Host ""
Write-Host "Done! Your AWS ALB should be turning healthy within the next 2-3 minutes!" -ForegroundColor Green
