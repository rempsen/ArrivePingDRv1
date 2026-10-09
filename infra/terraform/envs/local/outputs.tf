output "app_url" {
  description = "URL of the local web app"
  value       = local.app_url
}

output "studio_url" {
  description = "Drizzle Studio UI. local.drizzle.studio proxies to the studio container on localhost; it connects as the owner role, so it shows every tenant."
  value       = "http://local.drizzle.studio"
}
