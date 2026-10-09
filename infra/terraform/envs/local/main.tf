locals {
  repo_root   = abspath("${path.module}/../../../..")
  web_port    = 5173
  studio_port = 4983
  app_url     = "http://localhost:${local.web_port}"
}

# The stack is plain Compose YAML (compose.yaml.tftpl) rather than the
# provider's dockercompose_stack service blocks, whose depends_on cannot express
# conditions like service_completed_successfully.
resource "dockercompose_project" "nvc360-v4" {
  name = "nvc360-v4"

  compose_yaml = templatefile("${path.module}/compose.yaml.tftpl", {
    repo_root   = local.repo_root
    module_dir  = abspath(path.module)
    web_port    = local.web_port
    studio_port = local.studio_port
    app_url     = local.app_url
    # jsonencode makes it a valid YAML string; "$$" stops Compose interpolating
    # a literal "$" in the key.
    ai_gateway_api_key = jsonencode(replace(var.vercel_api_key, "$", "$$"))
  })
}
