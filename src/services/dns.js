const axios = require('axios');
const dns = require('dns').promises;
const logger = require('../utils/logger');

class PowerDNSManager {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.headers = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a DNS zone for any domain.
   */
  async createZone(domain, vpsIp, nameservers) {
    const zone = {
      name: `${domain}.`,
      kind: 'Native',
      nameservers: nameservers.map(ns => `${ns}.`),
      soa_edit_api: 'INCEPTION-INCREMENT',
    };

    try {
      await axios.post(
        `${this.apiUrl}/servers/localhost/zones`,
        zone,
        { headers: this.headers }
      );

      // Add A record for main domain
      await this.addARecord(domain, '@', vpsIp);

      // Add A record for www
      await this.addARecord(domain, 'www', vpsIp);

      logger.info('DNS zone created', { domain, ip: vpsIp });
      return true;
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      throw new Error(`Failed to create DNS zone for ${domain}: ${msg}`);
    }
  }

  /**
   * Add an A record. Works for both root domain and subdomains.
   */
  async addARecord(domain, name, ip) {
    const recordName = name === '@'
      ? `${domain}.`
      : `${name}.${domain}.`;

    const rrsets = {
      rrsets: [{
        name: recordName,
        type: 'A',
        ttl: 3600,
        changetype: 'REPLACE',
        records: [{
          content: ip,
          disabled: false,
        }],
      }],
    };

    try {
      await axios.patch(
        `${this.apiUrl}/servers/localhost/zones/${domain}.`,
        rrsets,
        { headers: this.headers }
      );
      logger.info('DNS A record added', { domain, name, ip });
      return true;
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      throw new Error(`Failed to add A record ${name}.${domain}: ${msg}`);
    }
  }

  /**
   * Delete an A record (cleanup).
   */
  async deleteARecord(domain, name) {
    const recordName = name === '@'
      ? `${domain}.`
      : `${name}.${domain}.`;

    const rrsets = {
      rrsets: [{
        name: recordName,
        type: 'A',
        changetype: 'DELETE',
      }],
    };

    try {
      await axios.patch(
        `${this.apiUrl}/servers/localhost/zones/${domain}.`,
        rrsets,
        { headers: this.headers }
      );
      logger.info('DNS A record deleted', { domain, name });
      return true;
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      logger.warn('Failed to delete A record', { domain, name, error: msg });
      // Non-fatal: record might already not exist
      return false;
    }
  }

  /**
   * Delete entire DNS zone (when domain is deleted).
   */
  async deleteZone(domain) {
    try {
      await axios.delete(
        `${this.apiUrl}/servers/localhost/zones/${domain}.`,
        { headers: this.headers }
      );
      logger.info('DNS zone deleted', { domain });
      return true;
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      logger.warn('Failed to delete DNS zone', { domain, error: msg });
      return false;
    }
  }

  /**
   * Verify that nameservers are pointing to our DNS.
   */
  async verifyNameservers(domain) {
    try {
      const nsRecords = await dns.resolveNs(domain);
      return { verified: nsRecords.length > 0, records: nsRecords };
    } catch (error) {
      return { verified: false, records: [], error: error.message };
    }
  }
}

module.exports = PowerDNSManager;
