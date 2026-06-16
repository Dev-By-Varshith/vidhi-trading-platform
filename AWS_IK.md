Now I have the full picture. Let me build the complete AWS deployment plan:
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0.25s;
    animation-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
  }
VvisualizeVvisualize show_widgetNow here's the complete step-by-step plan for someone new to AWS and cloud:

Your AWS services and why you need each one
Hosting the website:

S3 — stores your built React frontend files (HTML, JS, CSS)
CloudFront — global CDN that serves your website fast from everywhere, handles HTTPS
Route 53 — maps your like arena.vidhi.com to CloudFront

Running your backend:

ECS Fargate — runs your Go API server in a Docker container without managing servers yourself
ECR (Elastic Container Registry) — stores your Docker images (like GitHub but for containers)
ALB (Application Load Balancer) — receives all API traffic and routes it to your Go server

Running simulations:

EC2 c6i.2xlarge — a dedicated powerful server that runs your C++ Game Master, bots, and sandbox. This CANNOT be Fargate because you need bare-metal performance with isolcpus and hugepages
SQS — a job queue; when a student clicks "Submit Final", the API puts a job here and the EC2 worker picks it up

Storing data:

RDS (PostgreSQL + TimescaleDB) — stores all PnL scores, run history, leaderboard
Secrets Manager — stores your DB password, API keys, safely injected into containers
S3 (second bucket) — stores the deterministic tick dataset (public_99k.bin)

DevOps:

GitHub Actions — automates building and deploying on every git push
Terraform — defines all your AWS infrastructure as code so you can recreate it
CloudWatch — logs and alerts when something breaks


Step-by-step deployment plan
Phase 1 — AWS account setup (Day 1, ~2 hours)
1. Create AWS account at aws.amazon.com. Use a real email, add billing alerts immediately.
2. Enable billing alarm — go to CloudWatch → Alarms → create alarm on EstimatedCharges > $50. You don't want surprise bills.
3. Create an IAM user (never use root). In IAM → Users → Create user vidhi-deploy → attach AdministratorAccess temporarily. Download the access key CSV — you'll need AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
4. Install tools on your computer:
bash# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install
aws configure  # paste your access key + secret, region: us-east-1

# Terraform
wget https://releases.hashicorp.com/terraform/1.8.0/terraform_1.8.0_linux_amd64.zip
unzip terraform_1.8.0_linux_amd64.zip && sudo mv terraform /usr/local/bin/

# Docker
sudo apt install docker.io && sudo usermod -aG docker $USER

Phase 2 — Terraform infrastructure (Day 1-2, ~4 hours)
Your repo already has a terraform/ folder. Here's what each file should contain:
terraform/main.tf — the core config:
hclterraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Store state in S3 so teammates share it
  backend "s3" {
    bucket = "vidhi-terraform-state"
    key    = "arena/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" { region = "us-east-1" }
terraform/networking.tf — VPC, subnets, security groups:
hclresource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "vidhi-vpc" }
}

resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1a"
}

# Security group: ALB (port 80, 443 open)
resource "aws_security_group" "alb" {
  name   = "vidhi-alb-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=80  to_port=80  protocol="tcp" cidr_blocks=["0.0.0.0/0"] }
  ingress { from_port=443 to_port=443 protocol="tcp" cidr_blocks=["0.0.0.0/0"] }
  egress  { from_port=0   to_port=0   protocol="-1"  cidr_blocks=["0.0.0.0/0"] }
}

# Security group: ECS backend (only ALB can talk to it)
resource "aws_security_group" "backend" {
  name   = "vidhi-backend-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress { from_port=0 to_port=0 protocol="-1" cidr_blocks=["0.0.0.0/0"] }
}

# Security group: EC2 simulation runner
resource "aws_security_group" "sim_runner" {
  name   = "vidhi-sim-runner-sg"
  vpc_id = aws_vpc.main.id
  # Only backend ECS can call it
  ingress {
    from_port       = 9090
    to_port         = 9090
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }
  egress { from_port=0 to_port=0 protocol="-1" cidr_blocks=["0.0.0.0/0"] }
}
terraform/ec2_sim.tf — the bare-metal simulation server:
hclresource "aws_instance" "sim_runner" {
  ami                    = "ami-0c02fb55956c7d316"  # Amazon Linux 2 in us-east-1
  instance_type          = "c6i.2xlarge"             # 8 vCPU, 16GB RAM
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.sim_runner.id]
  key_name               = aws_key_pair.deploy.key_name

  # 50GB SSD for code compilation + containers
  root_block_device {
    volume_size = 50
    volume_type = "gp3"
  }

  # Bootstrap script: install Docker, isolate CPUs, enable hugepages
  user_data = file("${path.module}/scripts/ec2_bootstrap.sh")

  tags = { Name = "vidhi-sim-runner" }
}
terraform/scripts/ec2_bootstrap.sh:
bash#!/bin/bash
# Install Docker
yum update -y && yum install -y docker
systemctl start docker && systemctl enable docker

# Install Go for job worker
wget https://go.dev/dl/go1.22.linux-amd64.tar.gz
tar -C /usr/local -xzf go1.22.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile

# Enable hugepages (needed for C++ Game Master)
echo "vm.nr_hugepages = 128" >> /etc/sysctl.conf
sysctl -p

# Reserve CPUs 2-3 for Game Master (isolcpus in GRUB is better, this is the fast path)
echo 2-3 > /sys/devices/system/cpu/isolated 2>/dev/null || true
Deploy your infrastructure:
bashcd terraform/
terraform init     # downloads AWS provider
terraform plan     # shows what will be created (review carefully!)
terraform apply    # type "yes" to create everything
This creates your entire AWS infrastructure. Takes about 5 minutes. Costs begin here.

Phase 3 — Build and push Docker images (Day 2, ~2 hours)
Create your ECR repositories (Terraform can do this too, or use CLI):
bashaws ecr create-repository --repository-name vidhi-backend --region us-east-1
aws ecr create-repository --repository-name vidhi-sim-runner --region us-east-1
Your Dockerfile for the Go backend (backend/Dockerfile):
dockerfileFROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o vidhi-backend ./main.go

FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/vidhi-backend .
EXPOSE 8080
CMD ["./vidhi-backend"]
Build and push:
bash# Get your AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL="$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_URL

# Build and push backend
cd backend/
docker build -t vidhi-backend .
docker tag vidhi-backend $ECR_URL/vidhi-backend:latest
docker push $ECR_URL/vidhi-backend:latest

Phase 4 — Deploy the frontend to S3 + CloudFront (Day 2, ~1 hour)
bash# Build the React app
cd vidhi_context/
npm install
npm run build         # creates a dist/ folder

# Upload to S3
aws s3 sync dist/ s3://vidhi-frontend-bucket --delete

# Invalidate CloudFront cache so students see the new version immediately
aws cloudfront create-invalidation \
  --distribution-id YOUR_CF_DISTRIBUTION_ID \
  --paths "/*"
Your frontend is now live at your CloudFront URL (looks like d1abc123.cloudfront.net). After you add a Route 53 domain, it becomes arena.vidhi.com.

Phase 5 — Deploy the backend (ECS Fargate) (Day 2, ~1 hour)
ECS runs your Go API from the Docker image you pushed. The key config is the Task Definition which tells AWS what container to run and what environment variables to inject:
json{
  "family": "vidhi-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [{
    "name": "backend",
    "image": "YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/vidhi-backend:latest",
    "portMappings": [{"containerPort": 8080}],
    "secrets": [
      {"name": "DB_URL",      "valueFrom": "arn:aws:secretsmanager:us-east-1:...:secret:vidhi/db_url"},
      {"name": "API_KEY",     "valueFrom": "arn:aws:secretsmanager:us-east-1:...:secret:vidhi/api_key"}
    ],
    "environment": [
      {"name": "SQS_QUEUE_URL", "value": "https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT/vidhi-submissions"},
      {"name": "AWS_REGION",    "value": "us-east-1"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/vidhi-backend",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}

Phase 6 — The submission flow end-to-end (Day 3, ~3 hours)
This is the most important part. Here is exactly what happens when a student clicks "Submit Final":
Step 1: Frontend → Backend API
POST https://api.arena.vidhi.com/api/submit
Headers: X-API-Key: student_api_key
Body: { "round_id": 3, "code": "class Trader:\n  def run(self, state)..." }
Step 2: Backend validates and enqueues
Your backend/api/submit.go does:
gofunc HandleSubmit(w http.ResponseWriter, r *http.Request) {
    // 1. Validate API key (auth middleware)
    // 2. Run AST security scan (forge/scanner.py)
    // 3. Write submission to RDS (runs table)
    // 4. Send job to SQS:
    sqsClient.SendMessage(&sqs.SendMessageInput{
        QueueUrl: &queueURL,
        MessageBody: aws.String(`{
            "run_id": "uuid-here",
            "user_id": "student123",
            "round_id": 3,
            "code_s3_key": "submissions/student123/round3/code.py"
        }`),
    })
    // 5. Return 202 Accepted immediately (don't make student wait)
    w.WriteHeader(202)
    json.NewEncoder(w).Encode(map[string]string{"run_id": "uuid-here"})
}
Step 3: EC2 Job Worker picks up the SQS message
On the EC2 server, your job_worker process (running as a systemd service) polls SQS every second. When it gets a message it:

Downloads the code from S3
Calls forge.py to compile Python → .so
Passes the .so to the C++ Game Master via your rendezvous shared memory
Game Master runs 100k/1M ticks with the bot fleet
Reads the final PnL from the game master output
Writes the result back to RDS: UPDATE runs SET pnl=X, status='complete' WHERE run_id=Y
Deletes the SQS message

Step 4: Student sees their score
The frontend polls GET /api/runs/{run_id} every 3 seconds. Once status is complete, it shows the PnL and leaderboard update.

Phase 7 — GitHub Actions CI/CD (Day 3, ~1 hour)
Create .github/workflows/deploy.yml:
yamlname: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Build and push Docker image
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_URL }}
          docker build -t vidhi-backend backend/
          docker tag vidhi-backend ${{ secrets.ECR_URL }}/vidhi-backend:latest
          docker push ${{ secrets.ECR_URL }}/vidhi-backend:latest

      - name: Force ECS to use new image
        run: |
          aws ecs update-service \
            --cluster vidhi-cluster \
            --service vidhi-backend \
            --force-new-deployment

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: cd vidhi_context && npm ci && npm run build
      - run: aws s3 sync vidhi_context/dist/ s3://${{ secrets.FRONTEND_BUCKET }} --delete
      - run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_ID }} --paths "/*"
Add those secrets in your GitHub repo → Settings → Secrets.

Cost estimate per month
ServiceConfigEstimated costEC2 c6i.2xlarge~8hrs/day usage~$80/monthRDS db.t3.mediumPostgreSQL~$30/monthECS Fargate0.5 vCPU~$10/monthS3 + CloudFrontFrontend + tick data~$5/monthSQS + SecretsNegligible at small scale~$2/monthTotal~$127/month
Keep EC2 stopped when not running a contest — that drops cost to ~$40/month. Use aws ec2 stop-instances --instance-ids i-YOUR_ID after a contest round ends.

Files you need to create/update
FileWhat to put in itterraform/main.tfAWS provider + S3 backend stateterraform/networking.tfVPC, subnets, security groupsterraform/ec2_sim.tfc6i.2xlarge instanceterraform/ecs.tfFargate cluster, task definition, serviceterraform/rds.tfRDS PostgreSQL instanceterraform/sqs.tfSQS queue for submissionsterraform/s3.tfFrontend bucket + tick data bucketterraform/scripts/ec2_bootstrap.shDocker, hugepages, Go installbackend/DockerfileMulti-stage Go build.github/workflows/deploy.ymlCI/CD pipeline
The deploy_to_aws.sh in your repo is the manual version of what GitHub Actions automates. Start with the manual script to understand it, then automate.