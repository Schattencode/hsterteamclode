const logger = require('../utils/logger');

class VPSInstaller {
  constructor(sshManager) {
    this.ssh = sshManager;
  }

  /**
   * Full VPS provisioning: Nginx + PHP-FPM + Certbot + firewall.
   * Returns an object with installed component details.
   */
  async provisionWebServer(progressCallback) {
    const progress = progressCallback || (() => {});

    // Step 1: Update packages
    progress('Updating package lists');
    await this.ssh.exec('apt-get update', 120000);

    // Step 2: Install Nginx
    progress('Installing Nginx');
    await this.ssh.exec(
      'DEBIAN_FRONTEND=noninteractive apt-get install -y nginx',
      180000
    );
    await this.ssh.exec('systemctl enable nginx && systemctl start nginx');

    // Step 3: Install PHP-FPM + common extensions
    progress('Installing PHP-FPM');
    // Detect available PHP version (8.3, 8.2, 8.1, etc.)
    let phpVersion;
    try {
      const versions = await this.ssh.exec(
        'apt-cache search --names-only "^php[0-9.]+-fpm$" | sort -rV | head -1'
      );
      // e.g. "php8.3-fpm - server-side, HTML-embedded scripting language (FPM-CGI binary)"
      const match = versions.match(/php([\d.]+)-fpm/);
      phpVersion = match ? match[1] : '8.1';
    } catch {
      phpVersion = '8.1';
    }

    const phpPackages = [
      `php${phpVersion}-fpm`,
      `php${phpVersion}-cli`,
      `php${phpVersion}-common`,
      `php${phpVersion}-mysql`,
      `php${phpVersion}-xml`,
      `php${phpVersion}-curl`,
      `php${phpVersion}-mbstring`,
      `php${phpVersion}-zip`,
      `php${phpVersion}-gd`,
      `php${phpVersion}-intl`,
      `php${phpVersion}-bcmath`,
    ].join(' ');

    await this.ssh.exec(
      `DEBIAN_FRONTEND=noninteractive apt-get install -y ${phpPackages}`,
      300000
    );
    await this.ssh.exec(`systemctl enable php${phpVersion}-fpm && systemctl start php${phpVersion}-fpm`);

    // Step 4: Install Certbot
    progress('Installing Certbot (SSL)');
    await this.ssh.exec(
      'DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx',
      180000
    );

    // Step 5: Install useful tools
    progress('Installing utilities');
    await this.ssh.exec(
      'DEBIAN_FRONTEND=noninteractive apt-get install -y unzip curl wget',
      60000
    );

    // Step 6: Configure Nginx directories
    progress('Configuring Nginx');
    await this.ssh.exec('mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled');

    // Ensure nginx.conf includes sites-enabled
    try {
      const conf = await this.ssh.exec('cat /etc/nginx/nginx.conf');
      if (!conf.includes('sites-enabled')) {
        await this.ssh.exec(
          `sed -i '/http {/a \\    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf`
        );
      }
    } catch { /* ignore */ }

    // Remove default site
    await this.ssh.exec('rm -f /etc/nginx/sites-enabled/default').catch(() => {});

    // Step 7: Configure firewall (allow HTTP, HTTPS, SSH)
    progress('Configuring firewall');
    try {
      await this.ssh.exec('which ufw');
      await this.ssh.exec('ufw allow 22/tcp');
      await this.ssh.exec('ufw allow 80/tcp');
      await this.ssh.exec('ufw allow 443/tcp');
      await this.ssh.exec('echo "y" | ufw enable').catch(() => {});
    } catch {
      // ufw not available, skip firewall setup
    }

    // Step 8: Reload Nginx
    progress('Restarting services');
    await this.ssh.exec('systemctl restart nginx');
    await this.ssh.exec(`systemctl restart php${phpVersion}-fpm`);

    // Detect PHP-FPM socket path
    let phpSocket;
    try {
      phpSocket = await this.ssh.exec(
        `find /var/run/php/ -name "php*-fpm.sock" | head -1`
      );
      phpSocket = phpSocket.trim();
    } catch {
      phpSocket = `/var/run/php/php${phpVersion}-fpm.sock`;
    }

    logger.info('VPS provisioned successfully', { phpVersion, phpSocket });

    return {
      success: true,
      phpVersion,
      phpSocket,
      components: ['nginx', `php${phpVersion}-fpm`, 'certbot', 'ufw'],
    };
  }

  /**
   * Quick check + install of missing components during deploy.
   * Much faster than full provision - only installs what's missing.
   */
  async ensureReady(progress) {
    const p = progress || (() => {});

    // Check Nginx
    try {
      await this.ssh.exec('systemctl is-active nginx');
    } catch {
      p('Installing Nginx...');
      await this.ssh.exec('apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nginx', 180000);
      await this.ssh.exec('systemctl enable nginx && systemctl start nginx');
    }

    // Ensure directories
    await this.ssh.exec('mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled');

    // Ensure nginx.conf includes sites-enabled
    try {
      const conf = await this.ssh.exec('cat /etc/nginx/nginx.conf');
      if (!conf.includes('sites-enabled')) {
        await this.ssh.exec(
          `sed -i '/http {/a \\    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf`
        );
      }
    } catch { /* ignore */ }

    // Remove default site
    await this.ssh.exec('rm -f /etc/nginx/sites-enabled/default').catch(() => {});

    // Check PHP-FPM
    try {
      await this.ssh.exec('ls /var/run/php/php*-fpm.sock');
    } catch {
      p('Installing PHP-FPM...');
      let phpVersion = '8.1';
      try {
        const versions = await this.ssh.exec(
          'apt-cache search --names-only "^php[0-9.]+-fpm$" | sort -rV | head -1'
        );
        const match = versions.match(/php([\d.]+)-fpm/);
        if (match) phpVersion = match[1];
      } catch { /* use default */ }
      await this.ssh.exec(
        `DEBIAN_FRONTEND=noninteractive apt-get install -y php${phpVersion}-fpm php${phpVersion}-cli php${phpVersion}-common php${phpVersion}-mysql php${phpVersion}-xml php${phpVersion}-curl php${phpVersion}-mbstring php${phpVersion}-zip php${phpVersion}-gd`,
        300000
      );
      await this.ssh.exec(`systemctl enable php${phpVersion}-fpm && systemctl start php${phpVersion}-fpm`);
    }

    // Check certbot
    try {
      await this.ssh.exec('certbot --version');
    } catch {
      p('Installing Certbot...');
      await this.ssh.exec(
        'DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx',
        180000
      );
    }

    // Detect PHP-FPM socket
    let phpSocket;
    try {
      phpSocket = (await this.ssh.exec('find /var/run/php/ -name "php*-fpm.sock" | head -1')).trim();
    } catch {
      phpSocket = '/var/run/php/php8.1-fpm.sock';
    }

    return { phpSocket };
  }
}

module.exports = VPSInstaller;
