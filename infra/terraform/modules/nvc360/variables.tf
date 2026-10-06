variable "region" {
  description = "AWS region. us-east-2 matches the project account default and the region Turso already hosts our database in, so cross-region latency does not change during the Phase D migration."
  type        = string
  default     = "us-east-2"
}

variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
  default     = "nvc360-staging"
}

variable "github_repo" {
  description = "owner/repo allowed to assume the CI deploy role via OIDC, matched directly in the trust policy's sub/repository claims."
  type        = string
  default     = "rempsen/ArrivePingDRv1"
}

variable "container_port" {
  description = "Port the Bun server binds. Matches PORT in the Dockerfile."
  type        = number
  default     = 4200
}

variable "image_tag" {
  description = "ECR image tag App Runner should run. CI sets this to the commit SHA."
  type        = string
  default     = "latest"
}

variable "db_username" {
  description = "Master username for the staging Postgres instance."
  type        = string
  default     = "nvc360_admin"
}

variable "domain" {
  description = "Root domain hosted at GoDaddy that the staging hostname (demo.v4.<domain>) is carved from."
  type        = string
}
