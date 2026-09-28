-- Keycloak keeps its own schema, so it gets its own database on the same
-- server. In production this is a separate RDS database (or instance) with its
-- own credentials.
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
