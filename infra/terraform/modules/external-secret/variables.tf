variable "name" {
  description = "SSM parameter name/path, e.g. \"/nvc360/godaddy/api_key\"."
  type        = string
}

variable "description" {
  description = "Shown in the AWS console next to the parameter — say where the real value comes from and how to set it."
  type        = string
}

variable "initial_value" {
  description = "Seed value used only when the parameter is first created. Terraform ignores changes to the live value after that, since a developer sets the real value by hand via the AWS console or `aws ssm put-parameter --overwrite` — editing this variable later has no effect on an already-created parameter."
  type        = string
  sensitive   = true
  default     = "REPLACE_ME"
}

variable "type" {
  description = "SSM parameter type."
  type        = string
  default     = "SecureString"
}
