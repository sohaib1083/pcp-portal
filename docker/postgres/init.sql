-- Runs once, on first start of the database volume.
CREATE DATABASE keycloak;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
