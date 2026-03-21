const { Redis } = require("@upstash/redis");
const logger = require("../shared/logger");

/**
 * RedisClient — Singleton wrapper around the Upstash Redis SDK.
 *
 * Encapsulates connection configuration and provides a verified,
 * ready-to-use Redis instance to the rest of the application.
 */
class RedisClient {
  constructor() {
    this.client = null;
  }

  /**
   * Initializes the Redis connection using environment variables.
   * Verifies connectivity with a PING before returning.
   *
   * @returns {Promise<Redis>} The verified Redis client instance.
   * @throws {Error} If UPSTASH env vars are missing or PING fails.
   */
  async connect() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        "[RedisClient] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables."
      );
    }

    this.client = new Redis({ url, token });

    // Verify the connection
    const pong = await this.client.ping();
    logger.debug(`Redis connected (PING: ${pong})`);

    return this.client;
  }

  /**
   * Returns the active Redis client instance.
   *
   * @returns {Redis}
   * @throws {Error} If connect() has not been called.
   */
  getClient() {
    if (!this.client) {
      throw new Error("[RedisClient] Not connected. Call connect() first.");
    }
    return this.client;
  }
}

module.exports = new RedisClient();
