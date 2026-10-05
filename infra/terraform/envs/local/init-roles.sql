-- Local-dev only: pre-create the app's login roles with known passwords.
-- drizzle/0001_app_roles_and_rls.sql creates them IF NOT EXISTS and then
-- grants privileges, so it leaves these alone. Never use these passwords
-- outside the local Docker stack.
CREATE ROLE app_runtime WITH LOGIN PASSWORD 'app_runtime_local' NOBYPASSRLS;
CREATE ROLE app_system WITH LOGIN PASSWORD 'app_system_local' BYPASSRLS;
