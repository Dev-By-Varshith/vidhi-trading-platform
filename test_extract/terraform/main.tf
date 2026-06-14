terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- VPC & Networking ---
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "vidhi-arena-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true
}

# --- Application Load Balancer ---
module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 8.0"

  name               = "vidhi-arena-alb"
  load_balancer_type = "application"
  vpc_id             = module.vpc.vpc_id
  subnets            = module.vpc.public_subnets
  security_groups    = [aws_security_group.alb_sg.id]

  target_groups = [
    {
      name_prefix      = "vidhi-"
      backend_protocol = "HTTP"
      backend_port     = 8080
      target_type      = "instance"
      health_check = {
        enabled             = true
        interval            = 30
        path                = "/api/health"
        port                = "traffic-port"
        healthy_threshold   = 3
        unhealthy_threshold = 3
        timeout             = 6
        protocol            = "HTTP"
        matcher             = "200-399"
      }
    }
  ]

  http_tcp_listeners = [
    {
      port               = 80
      protocol           = "HTTP"
      target_group_index = 0
    }
  ]
}

resource "aws_security_group" "alb_sg" {
  name        = "vidhi-alb-sg"
  description = "Allow HTTP inbound traffic"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- EC2 Auto Scaling Group for Game Master & Orchestrator ---
# We use EC2 instead of Fargate because the Sandbox Manager needs access 
# to the Docker socket (/var/run/docker.sock) and Game Master needs /dev/shm.

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_security_group" "ec2_sg" {
  name        = "vidhi-ec2-sg"
  description = "Allow traffic from ALB and internal DBs"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_launch_template" "vidhi_lt" {
  name_prefix   = "vidhi-engine-"
  image_id      = data.aws_ami.amazon_linux_2023.id
  instance_type = "c6i.2xlarge" # Compute optimized for Game Master

  network_interfaces {
    security_groups             = [aws_security_group.ec2_sg.id]
    associate_public_ip_address = false
  }

  user_data = base64encode(<<-EOF
              #!/bin/bash
              set -e
              dnf update -y
              dnf install -y docker git aws-cli
              systemctl enable docker
              systemctl start docker
              usermod -aG docker ec2-user

              # Install docker-compose v2
              mkdir -p /usr/local/lib/docker/cli-plugins
              curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
                -o /usr/local/lib/docker/cli-plugins/docker-compose
              chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

              # ── BARE-METAL HFT KERNEL TUNING ─────────────────────────────────
              sed -i 's/^GRUB_CMDLINE_LINUX="/GRUB_CMDLINE_LINUX="isolcpus=managed_irq,domain,2-4 nohz_full=2-4 rcu_nocbs=2-4 processor.max_cstate=0 intel_idle.max_cstate=0 skew_tick=1 rcupdate.rcu_normal=1 hugepagesz=2M hugepages=512 /' \
                /etc/default/grub
              grub2-mkconfig -o /boot/grub2/grub.cfg

              # ── ECR Login + Pull all images ───────────────────────────────────
              ECR=042470866347.dkr.ecr.us-east-1.amazonaws.com
              aws ecr get-login-password --region us-east-1 | \
                docker login --username AWS --password-stdin $ECR

              docker pull $ECR/vidhi-engine-backend:latest
              docker pull $ECR/vidhi-engine-sandbox-manager:latest
              docker pull $ECR/vidhi-engine-frontend:latest
              docker pull $ECR/vidhi-sandbox:latest
              docker tag $ECR/vidhi-sandbox:latest vidhi_sandbox:latest

              # ── Write docker-compose.aws.yml ──────────────────────────────────
              mkdir -p /opt/vidhi
              cat > /opt/vidhi/docker-compose.aws.yml << 'COMPOSE'
              version: "3.9"
              networks:
                control_plane:
                  driver: bridge
              volumes:
                postgres_data:
                redis_data:
                uploads_data:
              services:
                postgres:
                  image: timescale/timescaledb:latest-pg16
                  container_name: vidhi_postgres
                  restart: unless-stopped
                  environment:
                    POSTGRES_USER: vidhi
                    POSTGRES_PASSWORD: "${DB_PASSWORD}"
                    POSTGRES_DB: vidhidb
                  cpuset: "0-1"
                  volumes:
                    - postgres_data:/var/lib/postgresql/data
                  networks: [control_plane]
                  healthcheck:
                    test: ["CMD-SHELL","pg_isready -U vidhi -d vidhidb"]
                    interval: 5s
                    retries: 10

                redis:
                  image: redis:7-alpine
                  container_name: vidhi_redis
                  restart: unless-stopped
                  cpuset: "0-1"
                  volumes:
                    - redis_data:/data
                  command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
                  networks: [control_plane]
                  healthcheck:
                    test: ["CMD","redis-cli","ping"]
                    interval: 5s
                    retries: 10

                sandbox_manager:
                  image: 042470866347.dkr.ecr.us-east-1.amazonaws.com/vidhi-engine-sandbox-manager:latest
                  container_name: vidhi_sandbox_manager
                  restart: unless-stopped
                  privileged: true
                  volumes:
                    - /var/run/docker.sock:/var/run/docker.sock
                    - uploads_data:/uploads
                    - /tmp/vidhi_pool:/tmp/vidhi_pool
                  networks: [control_plane]

                backend:
                  image: 042470866347.dkr.ecr.us-east-1.amazonaws.com/vidhi-engine-backend:latest
                  container_name: vidhi_backend
                  restart: unless-stopped
                  ipc: host
                  cpuset: "0-1"
                  ports:
                    - "8080:8080"
                  environment:
                    DATABASE_URL: "postgres://vidhi:${DB_PASSWORD}@vidhi_postgres:5432/vidhidb?sslmode=disable"
                    REDIS_URL: "vidhi_redis:6379"
                    DOCKER_HOST: "tcp://vidhi_sandbox_manager:8081"
                    FORGE_DIR: "/app/forge"
                    GM_BIN: "/app/vidhi-gm"
                    PORT: "8080"
                    CREDITS_PER_DAY: "500"
                    SO_CACHE: "/uploads/so"
                  volumes:
                    - uploads_data:/uploads
                  depends_on:
                    postgres:
                      condition: service_healthy
                    redis:
                      condition: service_healthy
                  networks: [control_plane]

                frontend:
                  image: 042470866347.dkr.ecr.us-east-1.amazonaws.com/vidhi-engine-frontend:latest
                  container_name: vidhi_frontend
                  restart: unless-stopped
                  ports:
                    - "80:80"
                  depends_on:
                    - backend
                  networks: [control_plane]
              COMPOSE

              # ── Write .env for docker-compose ─────────────────────────────────
              # DB_PASSWORD is injected via AWS SSM Parameter Store in production
              DB_PASSWORD=$(aws ssm get-parameter \
                --name /vidhi/db_password \
                --with-decryption \
                --query Parameter.Value \
                --output text \
                --region us-east-1 2>/dev/null || echo "vidhi_secret_changeme")
              echo "DB_PASSWORD=$DB_PASSWORD" > /opt/vidhi/.env

              # ── Start all services ────────────────────────────────────────────
              cd /opt/vidhi
              docker compose -f docker-compose.aws.yml --env-file .env up -d

              echo "✅ Vidhi Arena started on $(hostname)"
              EOF
  )
}

resource "aws_autoscaling_group" "vidhi_asg" {
  name                = "vidhi-engine-asg"
  vpc_zone_identifier = module.vpc.private_subnets
  desired_capacity    = 2
  max_size            = 10
  min_size            = 2
  target_group_arns   = module.alb.target_group_arns

  launch_template {
    id      = aws_launch_template.vidhi_lt.id
    version = "$Latest"
  }
}
