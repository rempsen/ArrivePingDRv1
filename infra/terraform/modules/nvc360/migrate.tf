# ---------------------------------------------------------------------------
# Database migrations + app role credentials.
#
# RDS is not publicly reachable, so migrations cannot run from GitHub Actions
# directly. Instead CD runs a one-off Fargate task from the same image, in the
# same subnets/security group as the web service (the only thing the database
# security group admits). The task runs src/api/database/migrate.ts, which
# creates the app_runtime / app_system login roles, applies the Drizzle
# migrations as the master user, then sets the role passwords.
#
# Passwords are generated here and live in Secrets Manager (and, like the
# master password, in Terraform state). Staging-only; never reuse for prod.
# ---------------------------------------------------------------------------

resource "random_password" "app_runtime" {
  length  = 32
  special = false
}

resource "random_password" "app_system" {
  length  = 32
  special = false
}

locals {
  db_host = aws_db_instance.postgres.endpoint # host:port
}

# Plain-string secrets injected straight into the web container. Managed here
# (not in app_config, which Terraform seeds once and never touches again) so a
# regenerated password always reaches the app.
resource "aws_secretsmanager_secret" "app_db_url" {
  name                    = "${var.name_prefix}/app-database-url"
  description             = "DATABASE_URL for the web container (app_runtime role, RLS enforced)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app_db_url" {
  secret_id     = aws_secretsmanager_secret.app_db_url.id
  secret_string = "postgresql://app_runtime:${random_password.app_runtime.result}@${local.db_host}/nvc360?sslmode=require"
}

resource "aws_secretsmanager_secret" "app_db_system_url" {
  name                    = "${var.name_prefix}/app-database-system-url"
  description             = "DATABASE_SYSTEM_URL for the web container (app_system role, BYPASSRLS)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app_db_system_url" {
  secret_id     = aws_secretsmanager_secret.app_db_system_url.id
  secret_string = "postgresql://app_system:${random_password.app_system.result}@${local.db_host}/nvc360?sslmode=require"
}

resource "aws_secretsmanager_secret" "migrate_config" {
  name                    = "${var.name_prefix}/migrate-config"
  description             = "Env for the one-off migration task: master URL plus app role passwords."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "migrate_config" {
  secret_id = aws_secretsmanager_secret.migrate_config.id
  secret_string = jsonencode({
    MIGRATION_DATABASE_URL = aws_secretsmanager_secret_version.db_url.secret_string
    APP_RUNTIME_PASSWORD   = random_password.app_runtime.result
    APP_SYSTEM_PASSWORD    = random_password.app_system.result
  })
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${aws_ecr_repository.web.repository_url}:${var.image_tag}"
      essential = true
      command   = ["bun", "src/api/database/migrate.ts"]

      secrets = [
        for k in ["MIGRATION_DATABASE_URL", "APP_RUNTIME_PASSWORD", "APP_SYSTEM_PASSWORD"] : {
          name      = k
          valueFrom = "${aws_secretsmanager_secret.migrate_config.arn}:${k}::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])

  # CD registers new revisions with the commit-SHA image; don't revert them.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}
