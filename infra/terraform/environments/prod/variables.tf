variable "region" {
  type        = string
  description = "AWS region."
}

variable "execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN."
}

variable "task_role_arn" {
  type        = string
  description = "ECS task role ARN."
}

variable "viper_proxy_image" {
  type        = string
  description = "Container image URI for viper proxy."
}

variable "raw_bucket_name" {
  type        = string
  description = "Raw telemetry bucket."
}

variable "upstream_url" {
  type        = string
  description = "LLM upstream URL."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Fargate subnets."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Fargate security groups."
}
