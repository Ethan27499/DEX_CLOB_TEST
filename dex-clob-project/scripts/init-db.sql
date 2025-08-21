-- Initialize DEX CLOB Database
-- This script creates the necessary databases and users

-- Create databases
CREATE DATABASE dex_clob;
CREATE DATABASE dex_clob_test;

-- Create user if not exists
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'dex_user') THEN

      CREATE ROLE dex_user LOGIN PASSWORD 'dex_password';
   END IF;
END
$do$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE dex_clob TO dex_user;
GRANT ALL PRIVILEGES ON DATABASE dex_clob_test TO dex_user;

-- Connect to dex_clob and grant schema privileges
\c dex_clob;
GRANT ALL ON SCHEMA public TO dex_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dex_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dex_user;

-- Connect to test database and grant schema privileges
\c dex_clob_test;
GRANT ALL ON SCHEMA public TO dex_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dex_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dex_user;
