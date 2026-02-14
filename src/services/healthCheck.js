const dns = require('dns').promises;
const logger = require('../utils/logger');

class HealthCheck {
  constructor(sshManager) {
    this.ssh = sshManager;
  }

  /**
   * Run post-deploy health checks for a domain on the VPS.
   * Returns { dns, http, ssl, files } with ok/fail status for each.
   */
  async check(domain, expectedIp, sitePath) {
    const results = {
      dns: { ok: false, detail: '' },
      http: { ok: false, detail: '' },
      ssl: { ok: false, detail: '' },
      files: { ok: false, detail: '' },
    };

    // 1. DNS check — resolve domain and verify it points to our IP
    try {
      const addresses = await dns.resolve4(domain);
      if (addresses.includes(expectedIp)) {
        results.dns = { ok: true, detail: `Resolves to ${expectedIp}` };
      } else {
        results.dns = { ok: false, detail: `Resolves to ${addresses.join(', ')}, expected ${expectedIp}` };
      }
    } catch (err) {
      results.dns = { ok: false, detail: `DNS lookup failed: ${err.code || err.message}` };
    }

    // 2. HTTP check — curl from VPS to itself
    try {
      const httpStatus = await this.ssh.exec(
        `curl -sI -o /dev/null -w "%{http_code}" --max-time 10 http://${domain}/`,
        15000
      );
      const code = parseInt(httpStatus.trim(), 10);
      if (code >= 200 && code < 400) {
        results.http = { ok: true, detail: `HTTP ${code}` };
      } else {
        results.http = { ok: false, detail: `HTTP ${code}` };
      }
    } catch (err) {
      results.http = { ok: false, detail: `HTTP check failed: ${err.message}` };
    }

    // 3. SSL check — verify certificate is valid via openssl
    try {
      const sslOutput = await this.ssh.exec(
        `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`,
        15000
      );
      if (sslOutput.includes('notAfter')) {
        results.ssl = { ok: true, detail: sslOutput.trim() };
      } else {
        results.ssl = { ok: false, detail: 'Certificate not found or invalid' };
      }
    } catch (err) {
      results.ssl = { ok: false, detail: `SSL check failed: ${err.message}` };
    }

    // 4. Files check — verify index file exists in site root
    try {
      const indexCheck = await this.ssh.exec(
        `test -f ${sitePath}/index.html && echo "html" || (test -f ${sitePath}/index.php && echo "php" || echo "missing")`
      );
      const result = indexCheck.trim();
      if (result === 'html' || result === 'php') {
        results.files = { ok: true, detail: `index.${result} found` };
      } else {
        results.files = { ok: false, detail: 'No index.html or index.php in site root' };
      }
    } catch (err) {
      results.files = { ok: false, detail: `File check failed: ${err.message}` };
    }

    logger.info('Health check completed', { domain, results });
    return results;
  }
}

module.exports = HealthCheck;
