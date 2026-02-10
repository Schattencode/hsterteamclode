# Hosting Management Bot

Telegram bot for automated multi-domain hosting management with built-in DNS server.

## Features

- **Universal** — Works with ANY domain, not hardcoded to a specific one
- **Multi-domain** — Host unlimited domains from a single bot
- **Unlimited subdomains** — Each subdomain gets its own directory, Nginx config, and SSL certificate
- **Automatic DNS** — PowerDNS integration for complete DNS control
- **Automatic SSL** — Let's Encrypt certificates via Certbot
- **Nginx auto-config** — Each site gets its own Nginx server block
- **Team management** — Role-based access control (Admin / Member)
- **Activity logging** — Full audit trail of all actions
- **Multi-VPS** — Manage multiple VPS servers from one bot

## Requirements

- Node.js 18+
- VPS with Ubuntu 20.04+ (root SSH access)
- Telegram Bot Token (from @BotFather)
- Domain registrar access (to update nameservers)

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment config:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` with your settings:
   - `TELEGRAM_BOT_TOKEN` — Your bot token from @BotFather
   - `TELEGRAM_ADMIN_IDS` — Comma-separated Telegram user IDs for admins
   - `NS1_HOSTNAME` / `NS2_HOSTNAME` — Your nameserver hostnames
   - `SSL_ADMIN_EMAIL` — Email for Let's Encrypt certificates
5. Start the bot:
   ```bash
   npm start
   ```

## First Steps

1. Start bot with `/start`
2. Add your first VPS server (provide IP, SSH user, SSH key path)
3. Bot will offer to install PowerDNS and Nginx
4. Add your first domain
5. Configure nameservers at your domain registrar
6. Upload website as a ZIP file
7. Bot configures DNS, Nginx, SSL — site is live!

## Architecture

Each domain and subdomain is completely independent:

```
/var/www/domain1.com/         ← Domain 1 files
/var/www/domain2.xyz/         ← Domain 2 files (different site)
/var/www/app.domain1.com/     ← Subdomain files (separate from domain1.com)
/var/www/blog.domain2.xyz/    ← Another subdomain (separate files)
```

Each gets its own:
- Nginx configuration in `/etc/nginx/sites-available/`
- SSL certificate via Certbot
- DNS A record in PowerDNS

## User Roles

### Admin
- Manage VPS servers
- Add/remove team members
- View all domains and activity logs
- Full system control

### Member
- Add and manage own domains
- Create subdomains
- Upload website files
- Obtain SSL certificates

## Project Structure

```
src/
├── index.js                    # Entry point
├── bot/
│   ├── bot.js                  # Bot initialization & text/document handlers
│   ├── handlers/
│   │   ├── start.js            # /start, /help, main menu
│   │   ├── domain.js           # Domain CRUD & deployment
│   │   ├── subdomain.js        # Subdomain CRUD & deployment
│   │   ├── admin.js            # Admin panel, VPS, stats, logs
│   │   └── team.js             # Team member management
│   ├── keyboards/
│   │   └── menus.js            # Inline keyboard definitions
│   └── middleware/
│       ├── auth.js             # Access control
│       └── logger.js           # Activity logging
├── services/
│   ├── ssh.js                  # SSH connection manager
│   ├── nginx.js                # Nginx config generator
│   ├── dns.js                  # PowerDNS API client
│   ├── ssl.js                  # Certbot/SSL manager
│   ├── fileManager.js          # ZIP upload/extract handler
│   ├── installer.js            # PowerDNS/Nginx auto-installer
│   └── vpsManager.js           # Deployment orchestrator
├── database/
│   ├── db.js                   # SQLite database operations
│   └── migrations.js           # Schema definitions
└── utils/
    ├── config.js               # Environment config loader
    ├── logger.js               # Winston logger
    └── validator.js            # Input validation
```

## Development

```bash
npm run dev    # Start with nodemon (auto-reload)
npm start      # Production start
```

## Security Notes

- SSH keys are stored on the bot server — keep the server secure
- Bot token and API keys are in `.env` — never commit this file
- All database operations use parameterized queries
- File uploads are validated for type and size
- Team access is role-based with ownership checks
