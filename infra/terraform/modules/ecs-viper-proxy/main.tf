resource "aws_ecs_cluster" "this" {
  name = var.cluster_name
}

resource "aws_ecs_task_definition" "proxy" {
  family                   = "vipergo-proxy"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions    = jsonencode([{
    name      = "viper-proxy"
    image     = var.image
    essential = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "VIPER_LOG_BUCKET", value = var.raw_bucket_name },
      { name = "VIPER_UPSTREAM_URL", value = var.upstream_url }
    ]
  }])
}

resource "aws_ecs_service" "proxy" {
  name            = "vipergo-proxy"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.proxy.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }
}
