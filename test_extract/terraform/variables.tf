variable "aws_region" {
  description = "AWS Region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS Account ID"
  type        = string
  default     = "042470866347"
}

variable "ecr_registry" {
  description = "ECR registry base URL"
  type        = string
  default     = "042470866347.dkr.ecr.us-east-1.amazonaws.com"
}

variable "db_username" {
  description = "Database master user"
  type        = string
  default     = "vidhi_admin"
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

output "alb_dns_name" {
  description = "The DNS name of the load balancer — use this as your public URL"
  value       = module.alb.lb_dns_name
}

output "db_endpoint" {
  description = "The connection endpoint for Postgres"
  value       = aws_db_instance.vidhi_postgres.endpoint
}

output "redis_endpoint" {
  description = "The connection endpoint for Redis"
  value       = aws_elasticache_cluster.vidhi_redis.cache_nodes[0].address
}

output "ecr_backend_url" {
  description = "ECR URL for backend image"
  value       = "${var.ecr_registry}/vidhi-engine-backend:latest"
}

output "ecr_sandbox_url" {
  description = "ECR URL for sandbox manager image"
  value       = "${var.ecr_registry}/vidhi-engine-sandbox-manager:latest"
}
