#!/bin/sh
set -eu
: "${FACTORY_DB_PASSWORD:?}" "${CLINIC_DB_PASSWORD:?}" "${EMPLOYEES_DB_PASSWORD:?}"
psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv factory_password FACTORY_DB_PASSWORD
\getenv clinic_password CLINIC_DB_PASSWORD
\getenv employees_password EMPLOYEES_DB_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'factory', :'factory_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'clinic', :'clinic_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'workforce', :'employees_password') \gexec
CREATE DATABASE factory OWNER factory;
CREATE DATABASE clinic OWNER clinic;
CREATE DATABASE workforce OWNER workforce;
REVOKE CONNECT ON DATABASE factory FROM PUBLIC;
REVOKE CONNECT ON DATABASE clinic FROM PUBLIC;
REVOKE CONNECT ON DATABASE workforce FROM PUBLIC;
GRANT CONNECT ON DATABASE factory TO factory;
GRANT CONNECT ON DATABASE clinic TO clinic;
GRANT CONNECT ON DATABASE workforce TO workforce;
SQL
