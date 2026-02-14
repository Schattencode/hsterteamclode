class NginxConfigGenerator {
  /**
   * Generate Nginx config for a main domain.
   * @param {string} domain
   * @param {string} sitePath
   * @param {string} phpSocket - e.g. /var/run/php/php8.3-fpm.sock
   */
  generateDomainConfig(domain, sitePath, phpSocket) {
    const sock = phpSocket || '/var/run/php/php8.1-fpm.sock';
    return `server {
    listen 80;
    server_name ${domain} www.${domain};

    root ${sitePath};
    index index.php index.html index.htm;

    access_log /var/log/nginx/${domain}-access.log;
    error_log /var/log/nginx/${domain}-error.log;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:${sock};
        fastcgi_index index.php;
    }

    location ~ /\\.ht {
        deny all;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 100M;
}
`;
  }

  /**
   * Generate Nginx config for a subdomain.
   * @param {string} fullDomain
   * @param {string} sitePath
   * @param {string} phpSocket
   */
  generateSubdomainConfig(fullDomain, sitePath, phpSocket) {
    const sock = phpSocket || '/var/run/php/php8.1-fpm.sock';
    return `server {
    listen 80;
    server_name ${fullDomain};

    root ${sitePath};
    index index.php index.html index.htm;

    access_log /var/log/nginx/${fullDomain}-access.log;
    error_log /var/log/nginx/${fullDomain}-error.log;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:${sock};
        fastcgi_index index.php;
    }

    location ~ /\\.ht {
        deny all;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 100M;
}
`;
  }

  getConfigPath(domain) {
    return `/etc/nginx/sites-available/${domain}`;
  }

  getEnabledPath(domain) {
    return `/etc/nginx/sites-enabled/${domain}`;
  }
}

module.exports = new NginxConfigGenerator();
