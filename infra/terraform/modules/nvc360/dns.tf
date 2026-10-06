terraform {
  required_providers {
    godaddy = {
      source = "zaneatwork/godaddy"
    }
  }
}

locals {
  staging_hostname = "demo.v4.${var.domain}"
  staging_url      = "https://${local.staging_hostname}"
}

resource "godaddy_domain_record" "staging" {
  domain = var.domain

  record {
    name = "demo.v4"
    type = "CNAME"
    data = aws_lb.web.dns_name
    ttl  = 600
  }
}

resource "aws_acm_certificate" "web" {
  domain_name       = local.staging_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "godaddy_domain_record" "acm_validation" {
  domain    = var.domain
  overwrite = false

  record {
    name = trimsuffix(
      tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_name,
      ".${var.domain}."
    )
    type = tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_type
    data = trimsuffix(
      tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_value,
      "."
    )
    ttl = 600
  }
}

resource "aws_acm_certificate_validation" "web" {
  certificate_arn = aws_acm_certificate.web.arn
  validation_record_fqdns = [
    tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_name
  ]

  depends_on = [godaddy_domain_record.acm_validation]
}
