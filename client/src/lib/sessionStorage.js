/**
 * sessionStorage.js
 * Thin wrappers around localStorage for trust token persistence.
 * Keeps storage concerns out of the hook logic.
 */

const TOKEN_KEY = "trust_token";

/**
 * Returns the stored trust token, or null if not present / stored as "null".
 * @returns {string | null}
 */
export function getToken() {
  const value = localStorage.getItem(TOKEN_KEY);
  return value === null || value === "null" ? null : value;
}

/**
 * Persists the trust token to localStorage.
 * Passing null removes the token.
 * @param {string | null} token
 */
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}
