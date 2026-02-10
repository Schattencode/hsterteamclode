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
      // Free port 53: stop and disable systemd-resolved (occupies port 53 on modern Ubuntu/Debian)
      try {
        await this.ssh.exec('systemctl stop systemd-resolved');
        await this.ssh.exec('systemctl disable systemd-resolved');
        logger.info('systemd-resolved stopped and disabled');
      } catch {
        // systemd-resolved may not be present on all systems
      }

      // Set up manual DNS resolution (since systemd-resolved is now disabled)
      try {
        // Remove symlink if /etc/resolv.conf points to systemd stub
        await this.ssh.exec('rm -f /etc/resolv.conf');
        await this.ssh.exec(`cat > /etc/resolv.conf << 'EOF'\nnameserver 8.8.8.8\nnameserver 1.1.1.1\nnameserver 8.8.4.4\nEOF`);
        logger.info('Manual /etc/resolv.conf configured');
      } catch (e) {
        logger.warn('Could not update resolv.conf', { error: e.message });
      }

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

      // Write PowerDNS configuration (compatible with PowerDNS 4.5+)
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

      // Kill anything still on port 53 just in case
      try {
        await this.ssh.exec("fuser -k 53/tcp 2>/dev/null; fuser -k 53/udp 2>/dev/null; sleep 1");
      } catch {
        // Nothing on port 53, that's fine
      }

      // Enable and start service
      await this.ssh.exec('systemctl enable pdns');
      try {
        await this.ssh.exec('systemctl restart pdns');
      } catch (startErr) {
        // Capture detailed diagnostics
        let diagnostics = '';
        try {
          diagnostics = await this.ssh.exec('journalctl -xeu pdns.service --no-pager -n 30 2>&1');
        } catch { /* ignore */ }
        let portInfo = '';
        try {
          portInfo = await this.ssh.exec('ss -tlnp | grep :53 2>&1');
        } catch { /* ignore */ }
        let configCheck = '';
        try {
          configCheck = await this.ssh.exec('cat /etc/powerdns/pdns.conf 2>&1');
        } catch { /* ignore */ }
        let schemaCheck = '';
        try {
          schemaCheck = await this.ssh.exec('ls -la /usr/share/pdns-backend-sqlite3/schema/ 2>&1');
        } catch { /* ignore */ }
        let dbCheck = '';
        try {
          dbCheck = await this.ssh.exec('ls -la /var/lib/powerdns/ 2>&1');
        } catch { /* ignore */ }

        const fullDiag = [
          `--- journalctl ---\n${diagnostics}`,
          `--- port 53 ---\n${portInfo}`,
          `--- pdns.conf ---\n${configCheck}`,
          `--- schema dir ---\n${schemaCheck}`,
          `--- db dir ---\n${dbCheck}`,
        ].join('\n\n');

        logger.error('PowerDNS start failed - diagnostics', { diagnostics: fullDiag });
        // Extract key error line from journalctl for a concise message
        const fatalLine = diagnostics.split('\n').find(l => l.includes('Fatal error')) || '';
        const shortDiag = fatalLine || diagnostics.slice(0, 500) || 'No journal output';
        throw new Error(`PowerDNS failed to start: ${shortDiag}`);
      }

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
