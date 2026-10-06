output "arn" {
  description = "ARN of the SSM parameter, for granting read access to it."
  value       = aws_ssm_parameter.this.arn
}

output "name" {
  description = "Name of the SSM parameter, for reading it back with data \"aws_ssm_parameter\"."
  value       = aws_ssm_parameter.this.name
}
