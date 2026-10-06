# An SSM parameter Terraform creates once and then leaves alone. Use this for
# values a developer has to set by hand out of band (third-party API keys,
# etc.) where Terraform's job is only to guarantee the parameter exists, never
# to own its value.
resource "aws_ssm_parameter" "this" {
  name        = var.name
  description = var.description
  type        = var.type
  value       = var.initial_value

  lifecycle {
    ignore_changes = [value]
  }
}
