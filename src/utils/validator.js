class Validator {
  /**
   * Validate domain name format
   * Accepts: example.com, my-site.co.uk, test.xyz
   * Rejects: www.example.com, http://example.com, sub.domain.com
   */
  static isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') return false;

    domain = domain.trim().toLowerCase();

    // Reject if starts with http/https
    if (domain.startsWith('http://') || domain.startsWith('https://')) return false;

    // Reject if starts with www.
    if (domain.startsWith('www.')) return false;

    // Domain regex: allows TLDs like .com, .co.uk, .xyz etc.
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/;
    return domainRegex.test(domain);
  }

  /**
   * Validate subdomain name (just the prefix part)
   * Accepts: app, api, blog, my-app
   * Rejects: www, mail, ftp, special chars
   */
  static isValidSubdomain(subdomain) {
    if (!subdomain || typeof subdomain !== 'string') return false;

    subdomain = subdomain.trim().toLowerCase();

    const reserved = ['www', 'mail', 'ftp', 'smtp', 'pop', 'imap', 'ns1', 'ns2', 'localhost', 'admin'];
    if (reserved.includes(subdomain)) return false;

    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    if (!subdomainRegex.test(subdomain)) return false;

    if (subdomain.length > 63) return false;

    return true;
  }

  /**
   * Validate IP address (IPv4)
   */
  static isValidIP(ip) {
    if (!ip || typeof ip !== 'string') return false;

    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;

    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255 && String(num) === part;
    });
  }

  /**
   * Validate SSH port
   */
  static isValidPort(port) {
    const num = parseInt(port, 10);
    return num >= 1 && num <= 65535;
  }

  /**
   * Validate Telegram user ID
   */
  static isValidTelegramId(id) {
    if (!id) return false;
    const str = String(id).trim();
    return /^\d+$/.test(str);
  }

  /**
   * Validate username (with or without @)
   */
  static isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    username = username.trim();
    if (username.startsWith('@')) username = username.slice(1);
    return /^[a-zA-Z0-9_]{5,32}$/.test(username);
  }

  /**
   * Sanitize domain name
   */
  static sanitizeDomain(domain) {
    if (!domain) return '';
    return domain.trim().toLowerCase().replace(/\/$/, '');
  }

  /**
   * Sanitize subdomain name
   */
  static sanitizeSubdomain(subdomain) {
    if (!subdomain) return '';
    return subdomain.trim().toLowerCase();
  }

  /**
   * Validate VPS name
   */
  static isValidVPSName(name) {
    if (!name || typeof name !== 'string') return false;
    name = name.trim();
    return name.length >= 1 && name.length <= 100;
  }
}

module.exports = Validator;
