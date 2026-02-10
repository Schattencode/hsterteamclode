const Database = require('better-sqlite3');
const path = require('path');
const { runMigrations } = require('./migrations');
const logger = require('../utils/logger');

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  initialize() {
    const dir = path.dirname(this.dbPath);
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    runMigrations(this.db);
    logger.info('Database initialized', { path: this.dbPath });
  }

  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }

  // ──────────────────────────────────────
  // VPS Operations
  // ──────────────────────────────────────

  createVPS({ name, ip, ssh_user, ssh_key_path, ssh_port }) {
    const stmt = this.db.prepare(
      `INSERT INTO vps (name, ip, ssh_user, ssh_key_path, ssh_port)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(name, ip, ssh_user || 'root', ssh_key_path, ssh_port || 22);
    return this.getVPS(result.lastInsertRowid);
  }

  getVPS(id) {
    return this.db.prepare('SELECT * FROM vps WHERE id = ?').get(id);
  }

  getVPSByIP(ip) {
    return this.db.prepare('SELECT * FROM vps WHERE ip = ?').get(ip);
  }

  getAllVPS() {
    return this.db.prepare('SELECT * FROM vps ORDER BY created_at DESC').all();
  }

  getActiveVPS() {
    return this.db.prepare("SELECT * FROM vps WHERE status = 'active' ORDER BY name").all();
  }

  updateVPS(id, fields) {
    const allowed = ['name', 'ip', 'ssh_user', 'ssh_key_path', 'ssh_port', 'dns_configured', 'status'];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    this.db.prepare(`UPDATE vps SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getVPS(id);
  }

  deleteVPS(id) {
    this.db.prepare('DELETE FROM vps WHERE id = ?').run(id);
  }

  getVPSDomainCount(vpsId) {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM domains WHERE vps_id = ?').get(vpsId);
    return row.count;
  }

  // ──────────────────────────────────────
  // Domain Operations
  // ──────────────────────────────────────

  createDomain({ domain, vps_id, ns1, ns2, created_by }) {
    const stmt = this.db.prepare(
      `INSERT INTO domains (domain, vps_id, ns1, ns2, created_by)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(domain, vps_id, ns1, ns2, created_by);
    return this.getDomain(result.lastInsertRowid);
  }

  getDomain(id) {
    return this.db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
  }

  getDomainByName(domain) {
    return this.db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
  }

  getAllDomains() {
    return this.db.prepare('SELECT * FROM domains ORDER BY created_at DESC').all();
  }

  getDomainsByVPS(vpsId) {
    return this.db.prepare('SELECT * FROM domains WHERE vps_id = ? ORDER BY domain').all(vpsId);
  }

  getDomainsByUser(telegramId) {
    return this.db.prepare('SELECT * FROM domains WHERE created_by = ? ORDER BY domain').all(telegramId);
  }

  updateDomain(id, fields) {
    const allowed = [
      'domain', 'ns1', 'ns2', 'ns_configured', 'site_path',
      'nginx_config_path', 'ssl_status', 'ssl_expiry', 'status',
    ];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    this.db.prepare(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getDomain(id);
  }

  deleteDomain(id) {
    // Subdomains cascade delete via foreign key
    this.db.prepare('DELETE FROM domains WHERE id = ?').run(id);
  }

  getDomainCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM domains').get();
    return row.count;
  }

  // ──────────────────────────────────────
  // Subdomain Operations
  // ──────────────────────────────────────

  createSubdomain({ subdomain, domain_id, full_domain, site_path, nginx_config_path, ssl_status, ssl_expiry, created_by }) {
    const stmt = this.db.prepare(
      `INSERT INTO subdomains (subdomain, domain_id, full_domain, site_path, nginx_config_path, ssl_status, ssl_expiry, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      subdomain, domain_id, full_domain,
      site_path || null, nginx_config_path || null,
      ssl_status || 'pending', ssl_expiry || null, created_by
    );
    return this.getSubdomain(result.lastInsertRowid);
  }

  getSubdomain(id) {
    return this.db.prepare('SELECT * FROM subdomains WHERE id = ?').get(id);
  }

  getSubdomainByFullDomain(fullDomain) {
    return this.db.prepare('SELECT * FROM subdomains WHERE full_domain = ?').get(fullDomain);
  }

  getSubdomainsByDomain(domainId) {
    return this.db.prepare('SELECT * FROM subdomains WHERE domain_id = ? ORDER BY subdomain').all(domainId);
  }

  updateSubdomain(id, fields) {
    const allowed = [
      'site_path', 'nginx_config_path', 'ssl_status', 'ssl_expiry', 'status',
    ];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    this.db.prepare(`UPDATE subdomains SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getSubdomain(id);
  }

  deleteSubdomain(id) {
    this.db.prepare('DELETE FROM subdomains WHERE id = ?').run(id);
  }

  getSubdomainCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM subdomains').get();
    return row.count;
  }

  getSubdomainCountByDomain(domainId) {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM subdomains WHERE domain_id = ?').get(domainId);
    return row.count;
  }

  // ──────────────────────────────────────
  // User Operations
  // ──────────────────────────────────────

  createUser({ telegram_id, username, first_name, last_name, role, created_by }) {
    const stmt = this.db.prepare(
      `INSERT INTO users (telegram_id, username, first_name, last_name, role, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(telegram_id, username, first_name, last_name, role || 'member', created_by);
    return this.getUser(result.lastInsertRowid);
  }

  getUser(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getUserByTelegramId(telegramId) {
    return this.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  }

  getAllUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY role, created_at').all();
  }

  getActiveUsers() {
    return this.db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY role, created_at").all();
  }

  updateUser(telegramId, fields) {
    const allowed = ['username', 'first_name', 'last_name', 'role', 'status', 'last_active'];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    values.push(String(telegramId));

    this.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`).run(...values);
    return this.getUserByTelegramId(telegramId);
  }

  deleteUser(telegramId) {
    this.db.prepare('DELETE FROM users WHERE telegram_id = ?').run(String(telegramId));
  }

  getUserCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get();
    return row.count;
  }

  getUserDomainCount(telegramId) {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM domains WHERE created_by = ?').get(String(telegramId));
    return row.count;
  }

  // ──────────────────────────────────────
  // Activity Log Operations
  // ──────────────────────────────────────

  logActivity({ user_telegram_id, action, resource_type, resource_id, details, ip_address, success, error_message }) {
    const stmt = this.db.prepare(
      `INSERT INTO activity_logs (user_telegram_id, action, resource_type, resource_id, details, ip_address, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      user_telegram_id, action, resource_type || null, resource_id || null,
      details || null, ip_address || null, success !== false ? 1 : 0, error_message || null
    );
  }

  getActivityLogs(limit = 50, offset = 0) {
    return this.db.prepare(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  getActivityLogsByUser(telegramId, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM activity_logs WHERE user_telegram_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(String(telegramId), limit);
  }

  getActivityLogCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM activity_logs').get();
    return row.count;
  }

  // ──────────────────────────────────────
  // Statistics
  // ──────────────────────────────────────

  getStats() {
    const domains = this.getDomainCount();
    const subdomains = this.getSubdomainCount();
    const users = this.getUserCount();
    const vps = this.db.prepare('SELECT COUNT(*) as count FROM vps').get().count;
    const activeSsl = this.db.prepare(
      "SELECT COUNT(*) as count FROM domains WHERE ssl_status = 'active'"
    ).get().count;
    const activeSubSsl = this.db.prepare(
      "SELECT COUNT(*) as count FROM subdomains WHERE ssl_status = 'active'"
    ).get().count;

    return {
      domains,
      subdomains,
      totalSites: domains + subdomains,
      users,
      vps,
      activeSsl: activeSsl + activeSubSsl,
    };
  }
}

module.exports = DB;
