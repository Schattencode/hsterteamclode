const axios = require('axios');
const logger = require('../utils/logger');

class CloudflareManager {
  constructor(apiToken) {
    this.apiToken = apiToken;
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
    this.headers = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Verify that the API token is valid.
   */
  async verifyToken() {
    try {
      const res = await axios.get(`${this.baseUrl}/user/tokens/verify`, {
        headers: this.headers,
      });
      return { valid: res.data.success, status: res.data.result?.status };
    } catch (error) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      return { valid: false, error: msg };
    }
  }

  /**
   * Create a DNS zone for a domain, or fetch existing one if it already exists.
   * Returns zone ID and assigned nameservers.
   */
  async createZone(domain) {
    try {
      const res = await axios.post(`${this.baseUrl}/zones`, {
        name: domain,
        jump_start: true,
      }, { headers: this.headers });

      if (!res.data.success) {
        throw new Error(res.data.errors?.[0]?.message || 'Zone creation failed');
      }

      const zone = res.data.result;
      logger.info('Cloudflare zone created', { domain, zoneId: zone.id });

      // Set SSL mode to "full" to prevent redirect loops when proxy is enabled
      await this.setSSLMode(zone.id, 'full');

      return {
        zoneId: zone.id,
        nameservers: zone.name_servers,
        status: zone.status,
      };
    } catch (error) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;

      // Zone already exists — fetch it and ensure SSL mode is correct
      if (msg.includes('already exists')) {
        logger.info('Zone already exists, fetching', { domain });
        const existing = await this.getZone(domain);
        await this.setSSLMode(existing.zoneId, 'full').catch(err => {
          logger.warn('Could not set SSL mode on existing zone', { domain, error: err.message });
        });
        return existing;
      }

      throw new Error(`Failed to create zone for ${domain}: ${msg}`);
    }
  }

  /**
   * Fetch an existing zone by domain name.
   */
  async getZone(domain) {
    try {
      const res = await axios.get(`${this.baseUrl}/zones`, {
        headers: this.headers,
        params: { name: domain },
      });

      if (!res.data.success || !res.data.result.length) {
        throw new Error(`Zone not found for ${domain}`);
      }

      const zone = res.data.result[0];
      logger.info('Cloudflare zone fetched', { domain, zoneId: zone.id });

      return {
        zoneId: zone.id,
        nameservers: zone.name_servers,
        status: zone.status,
      };
    } catch (error) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      throw new Error(`Failed to fetch zone for ${domain}: ${msg}`);
    }
  }

  /**
   * Add an A record to a zone.
   */
  async addARecord(zoneId, name, ip, proxied = false) {
    try {
      const res = await axios.post(`${this.baseUrl}/zones/${zoneId}/dns_records`, {
        type: 'A',
        name,
        content: ip,
        ttl: 1, // 1 = auto
        proxied,
      }, { headers: this.headers });

      if (!res.data.success) {
        throw new Error(res.data.errors?.[0]?.message || 'Record creation failed');
      }

      logger.info('Cloudflare A record added', { zoneId, name, ip });
      return res.data.result;
    } catch (error) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      throw new Error(`Failed to add A record for ${name}: ${msg}`);
    }
  }

  /**
   * Delete all A records matching a name in a zone.
   */
  async deleteARecordByName(zoneId, name) {
    try {
      const res = await axios.get(`${this.baseUrl}/zones/${zoneId}/dns_records`, {
        headers: this.headers,
        params: { type: 'A', name },
      });

      if (res.data.result && res.data.result.length > 0) {
        for (const record of res.data.result) {
          await axios.delete(
            `${this.baseUrl}/zones/${zoneId}/dns_records/${record.id}`,
            { headers: this.headers }
          );
        }
      }
      logger.info('Cloudflare A records deleted', { zoneId, name });
      return true;
    } catch (error) {
      logger.warn('Failed to delete A record', { name, error: error.message });
      return false;
    }
  }

  /**
   * Set SSL mode for a zone (off, flexible, full, strict).
   * "full" requires a cert on origin (self-signed OK).
   * "strict" requires a valid cert (e.g. Let's Encrypt).
   */
  async setSSLMode(zoneId, mode = 'full') {
    try {
      const res = await axios.patch(
        `${this.baseUrl}/zones/${zoneId}/settings/ssl`,
        { value: mode },
        { headers: this.headers }
      );

      if (!res.data.success) {
        throw new Error(res.data.errors?.[0]?.message || 'Failed to set SSL mode');
      }

      logger.info('Cloudflare SSL mode set', { zoneId, mode });
      return res.data.result;
    } catch (error) {
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      logger.error('Failed to set Cloudflare SSL mode', { zoneId, mode, error: msg });
      throw new Error(`Failed to set SSL mode to "${mode}": ${msg}`);
    }
  }

  /**
   * Delete an entire zone.
   */
  async deleteZone(zoneId) {
    try {
      await axios.delete(`${this.baseUrl}/zones/${zoneId}`, {
        headers: this.headers,
      });
      logger.info('Cloudflare zone deleted', { zoneId });
      return true;
    } catch (error) {
      logger.warn('Failed to delete zone', { zoneId, error: error.message });
      return false;
    }
  }
}

module.exports = CloudflareManager;
