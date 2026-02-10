const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._saveTimer = null;
  }

  async initialize() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');

    // Run migrations
    const { runMigrations } = require('./migrations');
    runMigrations(this.db);

    this._save();
    logger.info('Database initialized', { path: this.dbPath });
  }

  // Persist database to disk
  _save() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  // Auto-save after write operations (debounced)
  _autoSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 100);
  }

  close() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    if (this.db) {
      this._save();
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  // ── Helpers for sql.js ──

  // Run a SELECT and return all rows as array of objects
  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  // Run a SELECT and return first row as object (or undefined)
  _get(sql, params = []) {
    const rows = this._all(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  // Run INSERT/UPDATE/DELETE and return { lastInsertRowid, changes }
  _run(sql, params = []) {
    this.db.run(sql, params);
    const lastId = this.db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
    const changes = this.db.getRowsModified();
    this._autoSave();
    return { lastInsertRowid: lastId, changes };
  }

  // ──────────────────────────────────────
  // VPS Operations
  // ──────────────────────────────────────

  createVPS({ name, ip, ssh_user, ssh_auth_type, ssh_key_path, ssh_password, ssh_port }) {
    const result = this._run(
      `INSERT INTO vps (name, ip, ssh_user, ssh_auth_type, ssh_key_path, ssh_password, ssh_port) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, ip, ssh_user || 'root', ssh_auth_type || 'password', ssh_key_path || null, ssh_password || null, ssh_port || 22]
    );
    return this.getVPS(result.lastInsertRowid);
  }

  getVPS(id) {
    return this._get('SELECT * FROM vps WHERE id = ?', [id]);
  }

  getVPSByIP(ip) {
    return this._get('SELECT * FROM vps WHERE ip = ?', [ip]);
  }

  getAllVPS() {
    return this._all('SELECT * FROM vps ORDER BY created_at DESC');
  }

  getActiveVPS() {
    return this._all("SELECT * FROM vps WHERE status = 'active' ORDER BY name");
  }

  updateVPS(id, fields) {
    const allowed = ['name', 'ip', 'ssh_user', 'ssh_auth_type', 'ssh_key_path', 'ssh_password', 'ssh_port', 'dns_configured', 'status'];
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

    this._run(`UPDATE vps SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getVPS(id);
  }

  deleteVPS(id) {
    this._run('DELETE FROM vps WHERE id = ?', [id]);
  }

  getVPSDomainCount(vpsId) {
    const row = this._get('SELECT COUNT(*) as count FROM domains WHERE vps_id = ?', [vpsId]);
    return row ? row.count : 0;
  }

  // ──────────────────────────────────────
  // Domain Operations
  // ──────────────────────────────────────

  createDomain({ domain, vps_id, ns1, ns2, created_by }) {
    const result = this._run(
      `INSERT INTO domains (domain, vps_id, ns1, ns2, created_by) VALUES (?, ?, ?, ?, ?)`,
      [domain, vps_id, ns1, ns2, created_by]
    );
    return this.getDomain(result.lastInsertRowid);
  }

  getDomain(id) {
    return this._get('SELECT * FROM domains WHERE id = ?', [id]);
  }

  getDomainByName(domain) {
    return this._get('SELECT * FROM domains WHERE domain = ?', [domain]);
  }

  getAllDomains() {
    return this._all('SELECT * FROM domains ORDER BY created_at DESC');
  }

  getDomainsByVPS(vpsId) {
    return this._all('SELECT * FROM domains WHERE vps_id = ? ORDER BY domain', [vpsId]);
  }

  getDomainsByUser(telegramId) {
    return this._all('SELECT * FROM domains WHERE created_by = ? ORDER BY domain', [telegramId]);
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

    this._run(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getDomain(id);
  }

  deleteDomain(id) {
    // Subdomains cascade delete via foreign key
    this._run('DELETE FROM domains WHERE id = ?', [id]);
  }

  getDomainCount() {
    const row = this._get('SELECT COUNT(*) as count FROM domains');
    return row ? row.count : 0;
  }

  // ──────────────────────────────────────
  // Subdomain Operations
  // ──────────────────────────────────────

  createSubdomain({ subdomain, domain_id, full_domain, site_path, nginx_config_path, ssl_status, ssl_expiry, created_by }) {
    const result = this._run(
      `INSERT INTO subdomains (subdomain, domain_id, full_domain, site_path, nginx_config_path, ssl_status, ssl_expiry, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subdomain, domain_id, full_domain,
        site_path || null, nginx_config_path || null,
        ssl_status || 'pending', ssl_expiry || null, created_by,
      ]
    );
    return this.getSubdomain(result.lastInsertRowid);
  }

  getSubdomain(id) {
    return this._get('SELECT * FROM subdomains WHERE id = ?', [id]);
  }

  getSubdomainByFullDomain(fullDomain) {
    return this._get('SELECT * FROM subdomains WHERE full_domain = ?', [fullDomain]);
  }

  getSubdomainsByDomain(domainId) {
    return this._all('SELECT * FROM subdomains WHERE domain_id = ? ORDER BY subdomain', [domainId]);
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

    this._run(`UPDATE subdomains SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getSubdomain(id);
  }

  deleteSubdomain(id) {
    this._run('DELETE FROM subdomains WHERE id = ?', [id]);
  }

  getSubdomainCount() {
    const row = this._get('SELECT COUNT(*) as count FROM subdomains');
    return row ? row.count : 0;
  }

  getSubdomainCountByDomain(domainId) {
    const row = this._get('SELECT COUNT(*) as count FROM subdomains WHERE domain_id = ?', [domainId]);
    return row ? row.count : 0;
  }

  // ──────────────────────────────────────
  // User Operations
  // ──────────────────────────────────────

  createUser({ telegram_id, username, first_name, last_name, role, created_by }) {
    const result = this._run(
      `INSERT INTO users (telegram_id, username, first_name, last_name, role, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [telegram_id, username, first_name, last_name, role || 'member', created_by]
    );
    return this.getUser(result.lastInsertRowid);
  }

  getUser(id) {
    return this._get('SELECT * FROM users WHERE id = ?', [id]);
  }

  getUserByTelegramId(telegramId) {
    return this._get('SELECT * FROM users WHERE telegram_id = ?', [String(telegramId)]);
  }

  getAllUsers() {
    return this._all('SELECT * FROM users ORDER BY role, created_at');
  }

  getActiveUsers() {
    return this._all("SELECT * FROM users WHERE status = 'active' ORDER BY role, created_at");
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

    this._run(`UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`, values);
    return this.getUserByTelegramId(telegramId);
  }

  deleteUser(telegramId) {
    this._run('DELETE FROM users WHERE telegram_id = ?', [String(telegramId)]);
  }

  getUserCount() {
    const row = this._get('SELECT COUNT(*) as count FROM users');
    return row ? row.count : 0;
  }

  getUserDomainCount(telegramId) {
    const row = this._get('SELECT COUNT(*) as count FROM domains WHERE created_by = ?', [String(telegramId)]);
    return row ? row.count : 0;
  }

  // ──────────────────────────────────────
  // Activity Log Operations
  // ──────────────────────────────────────

  logActivity({ user_telegram_id, action, resource_type, resource_id, details, ip_address, success, error_message }) {
    this._run(
      `INSERT INTO activity_logs (user_telegram_id, action, resource_type, resource_id, details, ip_address, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_telegram_id, action, resource_type || null, resource_id || null,
        details || null, ip_address || null, success !== false ? 1 : 0, error_message || null,
      ]
    );
  }

  getActivityLogs(limit = 50, offset = 0) {
    return this._all(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
  }

  getActivityLogsByUser(telegramId, limit = 50) {
    return this._all(
      'SELECT * FROM activity_logs WHERE user_telegram_id = ? ORDER BY created_at DESC LIMIT ?',
      [String(telegramId), limit]
    );
  }

  getActivityLogCount() {
    const row = this._get('SELECT COUNT(*) as count FROM activity_logs');
    return row ? row.count : 0;
  }

  // ──────────────────────────────────────
  // Statistics
  // ──────────────────────────────────────

  getStats() {
    const domains = this.getDomainCount();
    const subdomains = this.getSubdomainCount();
    const users = this.getUserCount();
    const vpsRow = this._get('SELECT COUNT(*) as count FROM vps');
    const vps = vpsRow ? vpsRow.count : 0;
    const activeSslRow = this._get("SELECT COUNT(*) as count FROM domains WHERE ssl_status = 'active'");
    const activeSsl = activeSslRow ? activeSslRow.count : 0;
    const activeSubSslRow = this._get("SELECT COUNT(*) as count FROM subdomains WHERE ssl_status = 'active'");
    const activeSubSsl = activeSubSslRow ? activeSubSslRow.count : 0;

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
