class NginxConfigGenerator {
  /**
   * Generate Nginx config for a main domain.
   * Serves both domain.com and www.domain.com.
   */
  generateDomainConfig(domain, sitePath) {
    return `server {
    listen 80;
    server_name ${domain} www.${domain};

    root ${sitePath};
    index index.html index.htm;

    access_log /var/log/nginx/${domain}-access.log;
    error_log /var/log/nginx/${domain}-error.log;

    location / {
        try_files $uri $uri/ /index.html =404;
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
   * Only serves the exact subdomain hostname.
   */
  generateSubdomainConfig(fullDomain, sitePath) {
    return `server {
    listen 80;
    server_name ${fullDomain};

    root ${sitePath};
    index index.html index.htm;

    access_log /var/log/nginx/${fullDomain}-access.log;
    error_log /var/log/nginx/${fullDomain}-error.log;

    location / {
        try_files $uri $uri/ /index.html =404;
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
