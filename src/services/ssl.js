const logger = require('../utils/logger');

class SSLManager {
  constructor(sshManager) {
    this.ssh = sshManager;
  }

  /**
   * Obtain SSL certificate for any domain/subdomain via certbot + nginx plugin.
   */
  async obtainCertificate(domain, email, isSubdomain = false, staging = false) {
    // Ensure certbot is installed and working
    try {
      await this.ssh.exec('certbot --version');
    } catch {
      logger.info('Installing certbot', { domain });
      await this.ssh.exec(
        'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx',
        300000
      );
    }

    // Build domain flags
    const domains = isSubdomain
      ? `-d ${domain}`
      : `-d ${domain} -d www.${domain}`;

    const stagingFlag = staging ? '--staging' : '';

    const command = [
      'certbot --nginx',
      domains,
      '--non-interactive',
      '--agree-tos',
      `--email ${email}`,
      '--redirect',
      '--keep-until-expiring',
      stagingFlag,
    ].filter(Boolean).join(' ');

    try {
      const output = await this.ssh.exec(command, 180000); // 3 minute timeout for SSL

      // Validate: check that cert files actually exist on disk
      const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
      const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;

      const certExists = await this.ssh.exec(`test -f ${certPath} && echo "OK" || echo "MISSING"`)
        .then(out => out.trim() === 'OK')
        .catch(() => false);

      const keyExists = await this.ssh.exec(`test -f ${keyPath} && echo "OK" || echo "MISSING"`)
        .then(out => out.trim() === 'OK')
        .catch(() => false);

      if (!certExists || !keyExists) {
        logger.error('SSL cert files missing after certbot', { domain, certExists, keyExists });
        return {
          success: false,
          expiry: null,
          message: 'Certbot ran but certificate files are missing',
        };
      }

      // Validate: nginx config must pass syntax check after certbot modifications
      try {
        await this.ssh.exec('nginx -t');
      } catch (nginxErr) {
        logger.error('Nginx config invalid after certbot', { domain, error: nginxErr.message });
        return {
          success: false,
          expiry: null,
          message: `Nginx config broken after certbot: ${nginxErr.message}`,
        };
      }

      // Try to parse expiry from certbot output
      const expiryMatch = output.match(/(\d{4}-\d{2}-\d{2})/);
      const expiry = expiryMatch ? expiryMatch[1] : null;

      logger.info('SSL certificate obtained and verified', { domain, expiry });

      return {
        success: true,
        expiry,
        message: 'SSL certificate obtained successfully',
      };
    } catch (error) {
      logger.error('SSL certificate failed', { domain, error: error.message });
      throw new Error(`Failed to obtain SSL certificate for ${domain}: ${error.message}`);
    }
  }

  /**
   * Renew SSL certificate for a domain.
   */
  async renewCertificate(domain) {
    try {
      await this.ssh.exec(`certbot renew --cert-name ${domain} --force-renewal`, 180000);
      logger.info('SSL certificate renewed', { domain });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to renew SSL for ${domain}: ${error.message}`);
    }
  }

  /**
   * Delete SSL certificate (cleanup on domain removal).
   */
  async deleteCertificate(domain) {
    try {
      await this.ssh.exec(`certbot delete --cert-name ${domain} --non-interactive`);
      logger.info('SSL certificate deleted', { domain });
      return { success: true };
    } catch (error) {
      // Ignore errors - cert might not exist
      logger.warn('SSL certificate delete failed (may not exist)', { domain, error: error.message });
      return { success: true };
    }
  }
}

module.exports = SSLManager;
