#!/bin/sh
# Runs once, on a fresh volume, as POSTGRES_USER. The e2e tests drop and
# recreate their isolated database beside POSTGRES_DB. Production does not need
# this test database.
set -e
: "${POSTGRES_TEST_DB:?POSTGRES_TEST_DB must be set}"

psql -v ON_ERROR_STOP=1 -v name="$POSTGRES_TEST_DB" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE DATABASE %I', :'name')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = :'name')\gexec
SQL
