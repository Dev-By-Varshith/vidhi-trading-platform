# --- TimescaleDB (PostgreSQL) ---

resource "aws_security_group" "rds_sg" {
  name        = "vidhi-rds-sg"
  description = "Allow Postgres inbound from EC2"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
  }
}

resource "aws_db_subnet_group" "db_subnet" {
  name       = "vidhi-db-subnet"
  subnet_ids = module.vpc.private_subnets
}

# Note: We use standard Postgres RDS here, but in production, we would install the TimescaleDB extension.
# Timescale offers its own managed cloud, or it can be deployed on EC2 if strict TimescaleDB functions are needed that RDS doesn't support.
# For this setup, we provision standard RDS Postgres 16.

resource "aws_db_instance" "vidhi_postgres" {
  identifier           = "vidhi-production-db"
  allocated_storage    = 100
  engine               = "postgres"
  engine_version       = "16.1"
  instance_class       = "db.m6g.xlarge" # Memory optimized for timeseries
  username             = var.db_username
  password             = var.db_password
  parameter_group_name = "default.postgres16"
  skip_final_snapshot  = true
  
  db_subnet_group_name   = aws_db_subnet_group.db_subnet.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
}

# --- Redis (ElastiCache) ---

resource "aws_security_group" "redis_sg" {
  name        = "vidhi-redis-sg"
  description = "Allow Redis inbound from EC2"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
  }
}

resource "aws_elasticache_subnet_group" "redis_subnet" {
  name       = "vidhi-redis-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_cluster" "vidhi_redis" {
  cluster_id           = "vidhi-redis-queue"
  engine               = "redis"
  node_type            = "cache.m6g.large"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379

  subnet_group_name    = aws_elasticache_subnet_group.redis_subnet.name
  security_group_ids   = [aws_security_group.redis_sg.id]
}
