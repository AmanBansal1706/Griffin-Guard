variable "cluster_name" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "image" {
  type = string
}

variable "raw_bucket_name" {
  type = string
}

variable "upstream_url" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "secret_arns" {
  type    = map(string)
  default = {}
}
