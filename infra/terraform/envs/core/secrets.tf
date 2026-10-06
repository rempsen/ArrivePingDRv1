# ---------------------------------------------------------------------------
# GoDaddy API credentials. Terraform only guarantees these parameters exist —
# see modules/external-secret for how the placeholder/ignore-changes pattern
# works. A developer fills in the real key/secret by hand via the AWS console
# or `aws ssm put-parameter --overwrite`, so nothing sensitive ever needs to
# be committed to this repo.
# ---------------------------------------------------------------------------

module "godaddy_api_key" {
  source = "../../modules/external-secret"

  name        = "/nvc360/godaddy/api_key"
  description = "GoDaddy API key. Set by hand via the AWS console or `aws ssm put-parameter --overwrite`, not Terraform."
}

module "godaddy_api_secret" {
  source = "../../modules/external-secret"

  name        = "/nvc360/godaddy/api_secret"
  description = "GoDaddy API secret. Set by hand via the AWS console or `aws ssm put-parameter --overwrite`, not Terraform."
}
