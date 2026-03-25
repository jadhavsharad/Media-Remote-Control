/**
 * config/index.js — Single source of truth for all runtime configuration.
 *
 * Environment variables, TTLs, and tuning knobs live here.
 * No business logic, no imports from other project modules.
 */

/* -------------------- TTL CONSTANTS -------------------- */
const PAIR_CODE_TTL_MS = 60 * 1000;                    // 1 minute
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30 days (host + remote)
const RATE_LIMIT_MS = 200;                              // 200 ms

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  PAIR_CODE_TTL_MS,
  TOKEN_TTL_MS,
  RATE_LIMIT_MS,
};
