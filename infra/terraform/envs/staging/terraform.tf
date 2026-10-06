terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    godaddy = {
      source  = "zaneatwork/godaddy"
      version = "1.9.10"
    }
  }

  # State lives in S3 in the project account, versioned and encrypted, with
  # native S3 locking (use_lockfile) so no DynamoDB table is needed.
  # Bucket was bootstrapped by hand — a state backend cannot create itself.
  backend "s3" {
    bucket       = "nvc360-tfstate-293174400261"
    key          = "staging/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "us-east-2"

  default_tags {
    tags = {
      Project     = "nvc360"
      Environment = "staging"
      ManagedBy   = "terraform"
      Repo        = "rempsen/NVC360V4-5823-0110"
    }
  }
}

# Credentials live in SSM Parameter Store (infra/terraform/envs/core/secrets.tf),
# filled in by hand — never in this repo. Same AWS account/region as this env,
# so a plain data lookup is enough; no remote state needed.
data "aws_ssm_parameter" "godaddy_api_key" {
  name            = "/nvc360/godaddy/api_key"
  with_decryption = true
}

data "aws_ssm_parameter" "godaddy_api_secret" {
  name            = "/nvc360/godaddy/api_secret"
  with_decryption = true
}

provider "godaddy" {
  key    = data.aws_ssm_parameter.godaddy_api_key.value
  secret = data.aws_ssm_parameter.godaddy_api_secret.value
}