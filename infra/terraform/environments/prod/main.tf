terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

module "ecs_proxy" {
  source             = "../../modules/ecs-viper-proxy"
  cluster_name       = "vipergo-prod"
  execution_role_arn = var.execution_role_arn
  task_role_arn      = var.task_role_arn
  image              = var.viper_proxy_image
  raw_bucket_name    = var.raw_bucket_name
  upstream_url       = var.upstream_url
  subnet_ids         = var.subnet_ids
  security_group_ids = var.security_group_ids
}
