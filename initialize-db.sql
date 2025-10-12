-- Run this script after creating the 'autopricer' user and 'tf2autopricer' database
-- Connect to the database first: \c tf2autopricer

CREATE SCHEMA IF NOT EXISTS tf2 AUTHORIZATION autopricer;

CREATE TABLE tf2.listings (
  name character varying NOT NULL,
  sku character varying NOT NULL,
  currencies json NOT NULL,
  intent character varying NOT NULL,
  updated bigint NOT NULL,
  steamid character varying NOT NULL,
  PRIMARY KEY (name, sku, intent, steamid)
);

CREATE TABLE tf2.key_prices (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  buy_price_metal DECIMAL NOT NULL,
  sell_price_metal DECIMAL NOT NULL,
  timestamp INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tf2.listing_stats (
  sku TEXT PRIMARY KEY,
  current_count INTEGER DEFAULT 0,
  moving_avg_count REAL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW (),
  current_buy_count integer DEFAULT 0,
  moving_avg_buy_count real DEFAULT 0,
  current_sell_count integer DEFAULT 0,
  moving_avg_sell_count real DEFAULT 0
);

CREATE TABLE tf2.price_history (
  sku TEXT NOT NULL,
  buy_metal NUMERIC NOT NULL,
  sell_metal NUMERIC NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW ()
);
