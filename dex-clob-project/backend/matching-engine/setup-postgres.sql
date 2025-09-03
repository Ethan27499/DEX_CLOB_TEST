-- PostgreSQL Database Setup for DEX CLOB
-- Run this script to create the database and user

-- Create database
CREATE DATABASE dex_clob;

-- Create user (optional if using default postgres user)
-- CREATE USER dex_user WITH ENCRYPTED PASSWORD 'dex_password';

-- Grant privileges
-- GRANT ALL PRIVILEGES ON DATABASE dex_clob TO dex_user;

-- Connect to the new database
\c dex_clob;

-- Enable UUID extension (will be created by application)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tables will be created automatically by the application
-- This script just sets up the database instance
