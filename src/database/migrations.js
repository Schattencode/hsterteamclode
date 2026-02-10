const SCHEMA = `
-- VPS Servers table
CREATE TABLE IF NOT EXISTS vps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ip TEXT NOT NULL UNIQUE,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_auth_type TEXT NOT NULL DEFAULT 'password',
  ssh_key_path TEXT,
  ssh_password TEXT,
  ssh_port INTEGER DEFAULT 22,
  dns_configured BOOLEAN DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Domains table (each domain is independent)
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  vps_id INTEGER NOT NULL,
  ns1 TEXT,
  ns2 TEXT,
  ns_configured BOOLEAN DEFAULT 0,
  site_path TEXT,
  nginx_config_path TEXT,
  ssl_status TEXT DEFAULT 'pending',
  ssl_expiry TIMESTAMP,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  FOREIGN KEY (vps_id) REFERENCES vps(id) ON DELETE CASCADE
);

-- Subdomains table (each subdomain is independent with own files)
CREATE TABLE IF NOT EXISTS subdomains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain TEXT NOT NULL,
  domain_id INTEGER NOT NULL,
  full_domain TEXT NOT NULL UNIQUE,
  site_path TEXT,
  nginx_config_path TEXT,
  ssl_status TEXT DEFAULT 'pending',
  ssl_expiry TIMESTAMP,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

-- Users table (team access management)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP,
  created_by TEXT
);

-- Activity logs (audit trail)
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_telegram_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  success BOOLEAN DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_domains_vps ON domains(vps_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_domain ON subdomains(domain_id);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
`;

function runMigrations(db) {
  // sql.js uses db.run() for pragmas (no .pragma() method)
  db.run('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  // Migration: add ssh_auth_type and ssh_password columns if missing (for existing databases)
  try {
    const cols = db.exec("PRAGMA table_info(vps)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map(row => row[1]);
      if (!colNames.includes('ssh_auth_type')) {
        db.run("ALTER TABLE vps ADD COLUMN ssh_auth_type TEXT NOT NULL DEFAULT 'password'");
      }
      if (!colNames.includes('ssh_password')) {
        db.run("ALTER TABLE vps ADD COLUMN ssh_password TEXT");
      }
    }
  } catch {
    // Columns already exist or fresh database
  }
}

module.exports = { runMigrations };
