const logger = require('../utils/logger');

class SSLManager {
  constructor(sshManager) {
    this.ssh = sshManager;
  }

  /**
   * Obtain SSL certificate for any domain/subdomain via certbot + nginx plugin.
   */
  async obtainCertificate(domain, email, isSubdomain = false, staging = false) {
    // Ensure certbot is installed
    try {
      await this.ssh.exec('which certbot');
    } catch {
      logger.info('Installing certbot', { domain });
      await this.ssh.exec(
        'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx'
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

      // Try to parse expiry from certbot output
      const expiryMatch = output.match(/(\d{4}-\d{2}-\d{2})/);
      const expiry = expiryMatch ? expiryMatch[1] : null;

      logger.info('SSL certificate obtained', { domain, expiry });

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
