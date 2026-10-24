#!/bin/sh
# Runs once, on a fresh volume, as POSTGRES_USER. Keycloak keeps its own schema and the e2e tests drop and
# recreate theirs, so each gets its own database beside POSTGRES_DB. In production Keycloak's is a separate
# RDS database (or instance) with its own credentials, and there is no test database.
set -e
: "${KEYCLOAK_DB:?KEYCLOAK_DB must be set}"
: "${POSTGRES_TEST_DB:?POSTGRES_TEST_DB must be set}"

for database in "$KEYCLOAK_DB" "$POSTGRES_TEST_DB"; do
  psql -v ON_ERROR_STOP=1 -v name="$database" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE DATABASE %I', :'name')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = :'name')\gexec
SQL
done
