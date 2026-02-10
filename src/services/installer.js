const crypto = require('crypto');
const fs = require('fs/promises');
const logger = require('../utils/logger');

class PowerDNSInstaller {
  constructor(sshManager) {
    this.ssh = sshManager;
  }

  /**
   * Install and configure PowerDNS on the remote VPS.
   */
  async install() {
    try {
      // Update package lists
      await this.ssh.exec('apt-get update', 120000);

      // Install PowerDNS and SQLite3 backend
      await this.ssh.exec(
        'DEBIAN_FRONTEND=noninteractive apt-get install -y pdns-server pdns-backend-sqlite3 sqlite3',
        180000
      );

      // Generate random API key
      const apiKey = this.generateAPIKey();

      // Stop service before reconfiguring
      try {
        await this.ssh.exec('systemctl stop pdns');
      } catch {
        // May not be running yet
      }

      // Write PowerDNS configuration
      const config = [
        'launch=gsqlite3',
        'gsqlite3-database=/var/lib/powerdns/pdns.sqlite3',
        '',
        'local-address=0.0.0.0',
        'local-port=53',
        '',
        'webserver=yes',
        'webserver-address=127.0.0.1',
        'webserver-port=8081',
        'webserver-allow-from=127.0.0.1',
        '',
        'api=yes',
        `api-key=${apiKey}`,
        '',
        'soa-minimum-ttl=3600',
        'default-ttl=3600',
      ].join('\n');

      // Write config via echo (avoid needing to upload)
      await this.ssh.exec(`cat > /etc/powerdns/pdns.conf << 'PDNSEOF'\n${config}\nPDNSEOF`);

      // Initialize SQLite database for PowerDNS
      await this.ssh.exec('mkdir -p /var/lib/powerdns');

      // Remove existing DB if present to avoid schema conflicts
      await this.ssh.exec('rm -f /var/lib/powerdns/pdns.sqlite3');

      // Create schema
      await this.ssh.exec(
        'sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql'
      );

      // Set permissions
      await this.ssh.exec('chown -R pdns:pdns /var/lib/powerdns');

      // Enable and start service
      await this.ssh.exec('systemctl enable pdns');
      await this.ssh.exec('systemctl restart pdns');

      // Verify it's running
      await this.ssh.exec('systemctl is-active pdns');

      logger.info('PowerDNS installed successfully');

      return {
        success: true,
        apiKey,
        message: 'PowerDNS installed and configured successfully',
      };
    } catch (error) {
      logger.error('PowerDNS installation failed', { error: error.message });
      throw new Error(`PowerDNS installation failed: ${error.message}`);
    }
  }

  /**
   * Check if PowerDNS is already installed and running.
   */
  async isInstalled() {
    try {
      await this.ssh.exec('which pdns_server');
      await this.ssh.exec('systemctl is-active pdns');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install Nginx if not present.
   */
  async installNginx() {
    try {
      await this.ssh.exec('which nginx');
      logger.info('Nginx already installed');
    } catch {
      logger.info('Installing Nginx');
      await this.ssh.exec('apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nginx', 120000);
      await this.ssh.exec('systemctl enable nginx && systemctl start nginx');
    }
  }

  /**
   * Generate a random API key for PowerDNS.
   */
  generateAPIKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = PowerDNSInstaller;
