#!/bin/bash
# Runs once, on the first start of an empty Postgres volume.
# Chatwoot uses the postgres superuser (it installs extensions); n8n and Odoo get their own roles.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  -v n8n_pw="$N8N_DB_PASSWORD" -v odoo_pw="$ODOO_DB_PASSWORD" <<'SQL'
CREATE DATABASE chatwoot;
CREATE ROLE n8n LOGIN PASSWORD :'n8n_pw';
CREATE DATABASE n8n OWNER n8n;
-- Odoo creates its own database, so its role needs CREATEDB (and must not be a superuser).
CREATE ROLE odoo LOGIN CREATEDB PASSWORD :'odoo_pw';
SQL
