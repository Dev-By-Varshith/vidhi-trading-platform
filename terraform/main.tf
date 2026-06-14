terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Store state in S3 so teammates share it
  # backend "s3" {
  #   bucket = "vidhi-terraform-state"
  #   key    = "arena/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" { region = "us-east-1" }
