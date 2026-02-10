const SSHManager = require('./ssh');
const nginxConfig = require('./nginx');
const CloudflareManager = require('./cloudflare');
const SSLManager = require('./ssl');
const FileManager = require('./fileManager');
const Installer = require('./installer');
const path = require('path');
const fs = require('fs/promises');
const logger = require('../utils/logger');

class VPSManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  /**
   * Get a CloudflareManager instance using the token stored in DB settings.
   */
  _getCloudflare() {
    const token = this.db.getSetting('cloudflare_token');
    if (!token) {
      throw new Error('Cloudflare API token not configured. Admin must set it in Settings.');
    }
    return new CloudflareManager(token);
  }

  /**
   * Ensure Nginx is installed on the VPS, auto-install if missing.
   */
  async _ensureNginx(ssh, progress) {
    try {
      await ssh.exec('systemctl status nginx');
    } catch {
      progress('Installing Nginx...');
      await ssh.exec('apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nginx', 120000);
      await ssh.exec('systemctl enable nginx && systemctl start nginx');
    }
    // Always ensure config directories exist
    await ssh.exec('mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled');
    // Ensure nginx.conf includes sites-enabled
    try {
      const conf = await ssh.exec('cat /etc/nginx/nginx.conf');
      if (!conf.includes('sites-enabled')) {
        await ssh.exec(`sed -i '/http {/a \\    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf`);
      }
    } catch { /* ignore */ }
    // Remove default site to avoid conflicts
    await ssh.exec('rm -f /etc/nginx/sites-enabled/default').catch(() => {});
  }

  /**
   * Deploy a domain: upload files, configure Nginx, DNS, and SSL.
   */
  async deployDomain(domainData, zipFilePath, userTelegramId, progressCallback) {
    const { domain, vpsId } = domainData;

    const vps = this.db.getVPS(vpsId);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const ssl = new SSLManager(ssh);
    const fileManager = new FileManager(this.config.upload.tempDir);

    const progress = progressCallback || (() => {});

    try {
      // Step 1: Connect
      progress('Connecting to VPS');
      await ssh.connect();

      // Step 1.5: Ensure Nginx is installed
      await this._ensureNginx(ssh, progress);

      // Step 2: Create site directory
      const sitePath = `/var/www/${domain}`;
      progress(`Creating directory: ${sitePath}`);
      await ssh.exec(`mkdir -p ${sitePath}`);

      // Step 3: Extract ZIP
      progress('Extracting ZIP archive');
      const extractedPath = await fileManager.extractZip(zipFilePath);
      const fileCount = await fileManager.countFiles(extractedPath);
      const totalSize = await fileManager.getDirectorySize(extractedPath);

      // Step 4: Upload files
      progress(`Uploading ${fileCount} files`);
      await ssh.uploadDirectory(extractedPath, sitePath);

      // Step 5: Set permissions
      progress('Setting permissions');
      await ssh.exec(`chown -R www-data:www-data ${sitePath}`);
      await ssh.exec(`chmod -R 755 ${sitePath}`);

      // Step 6: Generate Nginx config
      progress('Generating Nginx configuration');
      const config = nginxConfig.generateDomainConfig(domain, sitePath);
      const configPath = nginxConfig.getConfigPath(domain);
      const enabledPath = nginxConfig.getEnabledPath(domain);

      // Write config to temp file, upload, clean up
      await fs.mkdir(fileManager.tempDir, { recursive: true });
      const tempConfig = path.resolve(fileManager.tempDir, `${domain}.conf`);
      await fs.writeFile(tempConfig, config);
      await ssh.uploadFile(tempConfig, configPath);
      await fs.unlink(tempConfig);

      // Step 7: Enable site
      progress('Activating site configuration');
      await ssh.exec(`ln -sf ${configPath} ${enabledPath}`);

      // Step 8: Create DNS records via Cloudflare
      progress('Creating DNS records (Cloudflare)');
      try {
        const cf = this._getCloudflare();
        const domainRow = this.db.getDomainByName(domain);
        if (domainRow && domainRow.cloudflare_zone_id) {
          await cf.addARecord(domainRow.cloudflare_zone_id, domain, vps.ip);
          await cf.addARecord(domainRow.cloudflare_zone_id, `www.${domain}`, vps.ip);
        }
      } catch (err) {
        logger.warn('Cloudflare DNS record creation skipped', { error: err.message });
      }

      // Step 9: Test and reload Nginx
      progress('Testing Nginx configuration');
      await ssh.exec('nginx -t');

      progress('Reloading Nginx');
      await ssh.exec('systemctl reload nginx');

      // Step 10: Obtain SSL
      progress('Obtaining SSL certificate');
      let sslResult = { success: false, expiry: null };
      try {
        sslResult = await ssl.obtainCertificate(
          domain,
          this.config.ssl.adminEmail,
          false,
          this.config.ssl.staging
        );
      } catch (err) {
        logger.warn('SSL certificate failed, site will work on HTTP', { domain, error: err.message });
      }

      // Step 11: Update database
      this.db.updateDomain(
        this.db.getDomainByName(domain).id,
        {
          site_path: sitePath,
          nginx_config_path: configPath,
          ssl_status: sslResult.success ? 'active' : 'pending',
          ssl_expiry: sslResult.expiry,
          status: 'active',
        }
      );

      // Step 12: Log activity
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'deploy_domain',
        resource_type: 'domain',
        resource_id: domain,
        details: JSON.stringify({ vps: vps.name, files: fileCount, size: totalSize }),
        success: true,
      });

      // Cleanup
      await fileManager.cleanup(extractedPath);
      await fileManager.removeFile(zipFilePath);
      ssh.disconnect();

      return {
        success: true,
        domain,
        https_url: `https://${domain}`,
        site_path: sitePath,
        fileCount,
        totalSize,
        sslActive: sslResult.success,
        sslExpiry: sslResult.expiry,
      };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'deploy_domain',
        resource_type: 'domain',
        resource_id: domain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Deploy a subdomain: separate directory, Nginx config, DNS record, and SSL.
   */
  async deploySubdomain(subdomainData, zipFilePath, userTelegramId, progressCallback) {
    const { subdomain, domainId, fullDomain } = subdomainData;

    const domainRow = this.db.getDomain(domainId);
    if (!domainRow) throw new Error('Parent domain not found');

    const vps = this.db.getVPS(domainRow.vps_id);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const ssl = new SSLManager(ssh);
    const fileManager = new FileManager(this.config.upload.tempDir);

    const progress = progressCallback || (() => {});

    try {
      progress('Connecting to VPS');
      await ssh.connect();

      await this._ensureNginx(ssh, progress);

      const sitePath = `/var/www/${fullDomain}`;
      progress(`Creating directory: ${sitePath}`);
      await ssh.exec(`mkdir -p ${sitePath}`);

      progress('Extracting ZIP archive');
      const extractedPath = await fileManager.extractZip(zipFilePath);
      const fileCount = await fileManager.countFiles(extractedPath);
      const totalSize = await fileManager.getDirectorySize(extractedPath);

      progress(`Uploading ${fileCount} files`);
      await ssh.uploadDirectory(extractedPath, sitePath);

      progress('Setting permissions');
      await ssh.exec(`chown -R www-data:www-data ${sitePath}`);
      await ssh.exec(`chmod -R 755 ${sitePath}`);

      progress('Generating Nginx configuration');
      const config = nginxConfig.generateSubdomainConfig(fullDomain, sitePath);
      const configPath = nginxConfig.getConfigPath(fullDomain);
      const enabledPath = nginxConfig.getEnabledPath(fullDomain);

      await fs.mkdir(fileManager.tempDir, { recursive: true });
      const tempConfig = path.resolve(fileManager.tempDir, `${fullDomain}.conf`);
      await fs.writeFile(tempConfig, config);
      await ssh.uploadFile(tempConfig, configPath);
      await fs.unlink(tempConfig);

      progress('Activating site configuration');
      await ssh.exec(`ln -sf ${configPath} ${enabledPath}`);

      // Add subdomain A record via Cloudflare
      progress(`Creating DNS A record for ${fullDomain}`);
      try {
        const cf = this._getCloudflare();
        if (domainRow.cloudflare_zone_id) {
          await cf.addARecord(domainRow.cloudflare_zone_id, fullDomain, vps.ip);
        }
      } catch (err) {
        logger.warn('Cloudflare subdomain DNS skipped', { error: err.message });
      }

      progress('Testing Nginx configuration');
      await ssh.exec('nginx -t');

      progress('Reloading Nginx');
      await ssh.exec('systemctl reload nginx');

      progress('Obtaining SSL certificate');
      let sslResult = { success: false, expiry: null };
      try {
        sslResult = await ssl.obtainCertificate(
          fullDomain,
          this.config.ssl.adminEmail,
          true,
          this.config.ssl.staging
        );
      } catch (err) {
        logger.warn('SSL certificate failed for subdomain', { fullDomain, error: err.message });
      }

      // Save to database
      this.db.createSubdomain({
        subdomain,
        domain_id: domainId,
        full_domain: fullDomain,
        site_path: sitePath,
        nginx_config_path: configPath,
        ssl_status: sslResult.success ? 'active' : 'pending',
        ssl_expiry: sslResult.expiry,
        created_by: userTelegramId,
      });

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'deploy_subdomain',
        resource_type: 'subdomain',
        resource_id: fullDomain,
        details: JSON.stringify({ parent: domainRow.domain, files: fileCount, size: totalSize }),
        success: true,
      });

      await fileManager.cleanup(extractedPath);
      await fileManager.removeFile(zipFilePath);
      ssh.disconnect();

      return {
        success: true,
        subdomain: fullDomain,
        https_url: `https://${fullDomain}`,
        site_path: sitePath,
        fileCount,
        totalSize,
        sslActive: sslResult.success,
        sslExpiry: sslResult.expiry,
      };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'deploy_subdomain',
        resource_type: 'subdomain',
        resource_id: fullDomain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Update site files for an existing domain.
   */
  async updateDomainFiles(domainId, zipFilePath, userTelegramId, progressCallback) {
    const domainRow = this.db.getDomain(domainId);
    if (!domainRow) throw new Error('Domain not found');

    const vps = this.db.getVPS(domainRow.vps_id);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const fileManager = new FileManager(this.config.upload.tempDir);
    const progress = progressCallback || (() => {});

    try {
      progress('Connecting to VPS');
      await ssh.connect();

      await this._ensureNginx(ssh, progress);

      // Use default path if site_path was never set (first deploy failed)
      const sitePath = domainRow.site_path || `/var/www/${domainRow.domain}`;

      progress(`Creating directory: ${sitePath}`);
      await ssh.exec(`mkdir -p ${sitePath}`);

      progress('Clearing existing files');
      await ssh.exec(`rm -rf ${sitePath}/*`);

      progress('Extracting ZIP archive');
      const extractedPath = await fileManager.extractZip(zipFilePath);
      const fileCount = await fileManager.countFiles(extractedPath);
      const totalSize = await fileManager.getDirectorySize(extractedPath);

      progress(`Uploading ${fileCount} files`);
      await ssh.uploadDirectory(extractedPath, sitePath);

      progress('Setting permissions');
      await ssh.exec(`chown -R www-data:www-data ${sitePath}`);
      await ssh.exec(`chmod -R 755 ${sitePath}`);

      // Always regenerate and upload Nginx config to ensure it's up to date
      progress('Generating Nginx configuration');
      const config = nginxConfig.generateDomainConfig(domainRow.domain, sitePath);
      const configPath = nginxConfig.getConfigPath(domainRow.domain);
      const enabledPath = nginxConfig.getEnabledPath(domainRow.domain);

      await fs.mkdir(fileManager.tempDir, { recursive: true });
      const tempConfig = path.resolve(fileManager.tempDir, `${domainRow.domain}.conf`);
      await fs.writeFile(tempConfig, config);
      await ssh.uploadFile(tempConfig, configPath);
      await fs.unlink(tempConfig);

      await ssh.exec(`ln -sf ${configPath} ${enabledPath}`);

      if (!domainRow.site_path || !domainRow.nginx_config_path) {
        this.db.updateDomain(domainId, {
          site_path: sitePath,
          nginx_config_path: configPath,
          status: 'active',
        });
      }

      progress('Reloading Nginx');
      await ssh.exec('nginx -t');
      await ssh.exec('systemctl reload nginx');

      // If first deploy never completed, create DNS A-records and obtain SSL
      const isRecovery = !domainRow.site_path || !domainRow.nginx_config_path;
      if (isRecovery && domainRow.cloudflare_zone_id) {
        progress('Creating DNS A-records (Cloudflare)');
        try {
          const cf = this._getCloudflare();
          await cf.addARecord(domainRow.cloudflare_zone_id, domainRow.domain, vps.ip);
          await cf.addARecord(domainRow.cloudflare_zone_id, `www.${domainRow.domain}`, vps.ip);
        } catch (err) {
          logger.warn('Cloudflare DNS record creation skipped', { error: err.message });
        }

        progress('Obtaining SSL certificate');
        try {
          const ssl = new SSLManager(ssh);
          const sslResult = await ssl.obtainCertificate(
            domainRow.domain,
            this.config.ssl.adminEmail,
            false,
            this.config.ssl.staging
          );
          this.db.updateDomain(domainId, {
            ssl_status: sslResult.success ? 'active' : 'pending',
            ssl_expiry: sslResult.expiry,
          });
        } catch (err) {
          logger.warn('SSL certificate skipped', { error: err.message });
        }
      }

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'update_domain_files',
        resource_type: 'domain',
        resource_id: domainRow.domain,
        details: JSON.stringify({ files: fileCount, size: totalSize }),
        success: true,
      });

      await fileManager.cleanup(extractedPath);
      await fileManager.removeFile(zipFilePath);
      ssh.disconnect();

      return { success: true, fileCount, totalSize, isRecovery };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'update_domain_files',
        resource_type: 'domain',
        resource_id: domainRow.domain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Update site files for an existing subdomain.
   */
  async updateSubdomainFiles(subdomainId, zipFilePath, userTelegramId, progressCallback) {
    const subdomainRow = this.db.getSubdomain(subdomainId);
    if (!subdomainRow) throw new Error('Subdomain not found');

    const domainRow = this.db.getDomain(subdomainRow.domain_id);
    const vps = this.db.getVPS(domainRow.vps_id);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const fileManager = new FileManager(this.config.upload.tempDir);
    const progress = progressCallback || (() => {});

    try {
      progress('Connecting to VPS');
      await ssh.connect();

      const sitePath = subdomainRow.site_path;

      progress('Clearing existing files');
      await ssh.exec(`rm -rf ${sitePath}/*`);

      progress('Extracting ZIP archive');
      const extractedPath = await fileManager.extractZip(zipFilePath);
      const fileCount = await fileManager.countFiles(extractedPath);
      const totalSize = await fileManager.getDirectorySize(extractedPath);

      progress(`Uploading ${fileCount} files`);
      await ssh.uploadDirectory(extractedPath, sitePath);

      progress('Setting permissions');
      await ssh.exec(`chown -R www-data:www-data ${sitePath}`);
      await ssh.exec(`chmod -R 755 ${sitePath}`);

      progress('Reloading Nginx');
      await ssh.exec('systemctl reload nginx');

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'update_subdomain_files',
        resource_type: 'subdomain',
        resource_id: subdomainRow.full_domain,
        details: JSON.stringify({ files: fileCount, size: totalSize }),
        success: true,
      });

      await fileManager.cleanup(extractedPath);
      await fileManager.removeFile(zipFilePath);
      ssh.disconnect();

      return { success: true, fileCount, totalSize };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'update_subdomain_files',
        resource_type: 'subdomain',
        resource_id: subdomainRow.full_domain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Delete a domain and all its subdomains, Nginx configs, SSL certs, DNS, and files.
   */
  async deleteDomain(domainId, userTelegramId, progressCallback) {
    const domainRow = this.db.getDomain(domainId);
    if (!domainRow) throw new Error('Domain not found');

    const vps = this.db.getVPS(domainRow.vps_id);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const ssl = new SSLManager(ssh);
    const progress = progressCallback || (() => {});

    try {
      progress('Connecting to VPS');
      await ssh.connect();

      // Delete all subdomains first
      const subdomains = this.db.getSubdomainsByDomain(domainId);
      for (const sub of subdomains) {
        progress(`Removing subdomain: ${sub.full_domain}`);
        await this._removeSubdomainFromServer(ssh, ssl, sub, domainRow);
      }

      // Disable Nginx config
      progress('Disabling Nginx configuration');
      await ssh.exec(`rm -f /etc/nginx/sites-enabled/${domainRow.domain}`);

      // Delete SSL certificate
      progress('Removing SSL certificate');
      await ssl.deleteCertificate(domainRow.domain);

      // Delete Nginx config file
      if (domainRow.nginx_config_path) {
        await ssh.exec(`rm -f ${domainRow.nginx_config_path}`);
      }

      // Delete website files
      progress(`Removing files from ${domainRow.site_path}`);
      if (domainRow.site_path) {
        await ssh.exec(`rm -rf ${domainRow.site_path}`);
      }

      // Reload Nginx
      progress('Reloading Nginx');
      await ssh.exec('systemctl reload nginx');

      // Delete Cloudflare DNS zone
      progress('Deleting DNS zone (Cloudflare)');
      try {
        if (domainRow.cloudflare_zone_id) {
          const cf = this._getCloudflare();
          await cf.deleteZone(domainRow.cloudflare_zone_id);
        }
      } catch (err) {
        logger.warn('Cloudflare zone deletion failed', { error: err.message });
      }

      // Delete from database (cascades subdomains)
      progress('Updating database');
      this.db.deleteDomain(domainId);

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'delete_domain',
        resource_type: 'domain',
        resource_id: domainRow.domain,
        success: true,
      });

      ssh.disconnect();
      return { success: true };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'delete_domain',
        resource_type: 'domain',
        resource_id: domainRow.domain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Delete a single subdomain.
   */
  async deleteSubdomain(subdomainId, userTelegramId, progressCallback) {
    const subdomainRow = this.db.getSubdomain(subdomainId);
    if (!subdomainRow) throw new Error('Subdomain not found');

    const domainRow = this.db.getDomain(subdomainRow.domain_id);
    if (!domainRow) throw new Error('Parent domain not found');

    const vps = this.db.getVPS(domainRow.vps_id);
    if (!vps) throw new Error('VPS not found');

    const ssh = new SSHManager(vps);
    const ssl = new SSLManager(ssh);
    const progress = progressCallback || (() => {});

    try {
      progress('Connecting to VPS');
      await ssh.connect();

      await this._removeSubdomainFromServer(ssh, ssl, subdomainRow, domainRow, progress);

      progress('Reloading Nginx');
      await ssh.exec('systemctl reload nginx');

      // Delete from database
      progress('Updating database');
      this.db.deleteSubdomain(subdomainId);

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'delete_subdomain',
        resource_type: 'subdomain',
        resource_id: subdomainRow.full_domain,
        success: true,
      });

      ssh.disconnect();
      return { success: true };
    } catch (error) {
      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'delete_subdomain',
        resource_type: 'subdomain',
        resource_id: subdomainRow.full_domain,
        success: false,
        error_message: error.message,
      });

      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Renew SSL for a domain.
   */
  async renewSSL(domainId, userTelegramId) {
    const domainRow = this.db.getDomain(domainId);
    if (!domainRow) throw new Error('Domain not found');

    const vps = this.db.getVPS(domainRow.vps_id);
    const ssh = new SSHManager(vps);
    const ssl = new SSLManager(ssh);

    try {
      await ssh.connect();

      // Use obtainCertificate which handles both new and existing certs
      const sslResult = await ssl.obtainCertificate(
        domainRow.domain,
        this.config.ssl.adminEmail,
        false,
        this.config.ssl.staging
      );

      this.db.updateDomain(domainId, {
        ssl_status: sslResult.success ? 'active' : 'pending',
        ssl_expiry: sslResult.expiry,
      });

      this.db.logActivity({
        user_telegram_id: userTelegramId,
        action: 'renew_ssl',
        resource_type: 'domain',
        resource_id: domainRow.domain,
        success: true,
      });

      ssh.disconnect();
      return { success: true, expiry: sslResult.expiry };
    } catch (error) {
      ssh.disconnect();
      throw error;
    }
  }

  /**
   * Internal helper to remove a subdomain's server resources.
   */
  async _removeSubdomainFromServer(ssh, ssl, subdomainRow, domainRow, progress) {
    const p = progress || (() => {});

    p(`Disabling Nginx for ${subdomainRow.full_domain}`);
    await ssh.exec(`rm -f /etc/nginx/sites-enabled/${subdomainRow.full_domain}`).catch(() => {});

    p('Removing SSL certificate');
    await ssl.deleteCertificate(subdomainRow.full_domain);

    if (subdomainRow.nginx_config_path) {
      await ssh.exec(`rm -f ${subdomainRow.nginx_config_path}`).catch(() => {});
    }

    if (subdomainRow.site_path) {
      p(`Removing files from ${subdomainRow.site_path}`);
      await ssh.exec(`rm -rf ${subdomainRow.site_path}`).catch(() => {});
    }

    // Delete subdomain DNS record from Cloudflare
    p('Deleting DNS record');
    try {
      if (domainRow.cloudflare_zone_id) {
        const cf = this._getCloudflare();
        await cf.deleteARecordByName(domainRow.cloudflare_zone_id, subdomainRow.full_domain);
      }
    } catch (err) {
      logger.warn('Cloudflare subdomain DNS deletion failed', { error: err.message });
    }
  }
}

module.exports = VPSManager;
