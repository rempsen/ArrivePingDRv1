locals {
  repo_root = abspath("${path.module}/../../../..")
  web_port  = 5173
  app_url   = "http://localhost:${local.web_port}"
}

resource "dockercompose_stack" "nvc360-v4" {
  name        = "nvc360-v4"
  working_dir = path.module

  service {
    name    = "db"
    image   = "postgres:16"
    restart = "unless-stopped"

    # The app connects with ssl: "require" (built for Supabase), so serve TLS
    # using the self-signed cert bundled in the Debian image.
    command = [
      "postgres",
      "-c", "ssl=on",
      "-c", "ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem",
      "-c", "ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key",
    ]

    ports = [
      "5432:5432",
    ]

    environment = {
      POSTGRES_USER     = "postgres"
      POSTGRES_PASSWORD = "postgres_local"
      POSTGRES_DB       = "nvc360"
    }

    volumes = [
      "pg-data:/var/lib/postgresql/data",
      "${abspath(path.module)}/init-roles.sql:/docker-entrypoint-initdb.d/init-roles.sql:ro",
    ]

    healthcheck_test     = ["CMD-SHELL", "pg_isready -U postgres -d nvc360"]
    healthcheck_interval = "5s"
    healthcheck_retries  = 10
  }

  service {
    name       = "web"
    image      = "oven/bun:alpine"
    depends_on = ["db", "redis"]
    # Mount the whole bun workspace: runtime deps such as `postgres` and
    # `stripe` are declared in the root package.json, as in the Dockerfile.
    working_dir = "/repo/packages/web"
    entrypoint  = ["/bin/sh", "/repo/dev/docker/entrypoint.sh"]

    ports = [
      "${local.web_port}:${local.web_port}",
    ]

    environment = {
      # Migrations run as the owner; the app connects as the RLS-enforced
      # app_runtime role, with app_system for pre-tenant lookups.
      SUPABASE_MIGRATION_URL = "postgres://postgres:postgres_local@db:5432/nvc360"
      DATABASE_URL           = "postgres://app_runtime:app_runtime_local@db:5432/nvc360"
      DATABASE_SYSTEM_URL    = "postgres://app_system:app_system_local@db:5432/nvc360"
      BETTER_AUTH_URL        = local.app_url
      REDIS_URL              = "redis://redis:6379"
      # AI Gateway (agent/gateway.ts). Unset AI_GATEWAY_BASE_URL = Vercel's.
      AI_GATEWAY_API_KEY = var.vercel_api_key
    }

    volumes = [
      "${local.repo_root}:/repo",
      # Keep Linux-built dependencies in volumes, out of the host checkout.
      "node-modules:/repo/node_modules",
      "web-node-modules:/repo/packages/web/node_modules",
      "desktop-node-modules:/repo/packages/desktop/node_modules",
      "mobile-node-modules:/repo/packages/mobile/node_modules",
    ]
  }

  service {
    name    = "redis"
    image   = "redis:7-alpine"
    restart = "unless-stopped"

    ports = [
      "6379:6379",
    ]
  }

  volume {
    name = "pg-data"
  }

  volume {
    name = "node-modules"
  }

  volume {
    name = "web-node-modules"
  }

  volume {
    name = "desktop-node-modules"
  }

  volume {
    name = "mobile-node-modules"
  }
}