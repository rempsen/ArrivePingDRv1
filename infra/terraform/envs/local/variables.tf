variable "vercel_api_key" {
  description = "Vercel AI Gateway API key, passed to the web container as AI_GATEWAY_API_KEY. Create one at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys and put it in terraform.tfvars (gitignored; see terraform.tfvars.example)."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.vercel_api_key)) > 0
    error_message = "vercel_api_key must not be empty. Copy terraform.tfvars.example to terraform.tfvars and fill it in."
  }
}
