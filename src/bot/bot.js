const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const Validator = require('../utils/validator');
const FileManager = require('../services/fileManager');
const VPSManager = require('../services/vpsManager');
const AuthMiddleware = require('./middleware/auth');
const ActivityLogger = require('./middleware/logger');
const menus = require('./keyboards/menus');

const { registerStartHandlers } = require('./handlers/start');
const { registerDomainHandlers } = require('./handlers/domain');
const { registerSubdomainHandlers } = require('./handlers/subdomain');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerTeamHandlers } = require('./handlers/team');

/**
 * Initialize and configure the Telegram bot with all handlers.
 */
function createBot(db, config) {
  const bot = new TelegramBot(config.telegram.token, { polling: true });

  // Shared state for multi-step flows (keyed by Telegram user ID)
  bot._userStates = {};

  // Shared service instances
  const auth = new AuthMiddleware(db, config.telegram.adminIds);
  const activityLogger = new ActivityLogger(db);
  const vpsManager = new VPSManager(db, config);
  const fileManager = new FileManager(config.upload.tempDir);

  // Register all callback_query and command handlers
  registerStartHandlers(bot, db, auth, activityLogger);
  registerDomainHandlers(bot, db, auth, activityLogger, vpsManager, config);
  registerSubdomainHandlers(bot, db, auth, activityLogger, vpsManager, config);
  registerAdminHandlers(bot, db, auth, activityLogger, config);
  registerTeamHandlers(bot, db, auth, activityLogger);

  // ────────────────────────────────────────────────────
  // TEXT MESSAGE STATE MACHINE
  // Handles multi-step text input for all flows
  // ────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    // Skip commands (handled above) and non-text messages (handled below for docs)
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim();

    const state = bot._userStates[userId];
    if (!state) return; // No active flow

    const access = await auth.checkAccess(msg);
    if (!access.allowed) {
      return bot.sendMessage(chatId, access.reason);
    }

    // Helper to escape Markdown special chars in user input
    const esc = (t) => Validator.escMd(t);

    try {
      // ── VPS SETUP FLOW ──

      if (state.step === 'vps_enter_name') {
        if (!Validator.isValidVPSName(text)) {
          return bot.sendMessage(chatId, '❌ Invalid VPS name. Please try again.', menus.cancelButton());
        }
        state.vpsName = text;
        state.step = 'vps_enter_ip';
        return bot.sendMessage(chatId,
          `✅ VPS Name: ${esc(text)}\n\n📝 Step 2/5\nPlease enter the IP address of your VPS:\nExample: 123.45.67.89`,
          menus.cancelButton()
        );
      }

      if (state.step === 'vps_enter_ip') {
        if (!Validator.isValidIP(text)) {
          return bot.sendMessage(chatId, '❌ Invalid IP address. Please enter a valid IPv4 address.', menus.cancelButton());
        }
        // Check uniqueness
        const existing = db.getVPSByIP(text);
        if (existing) {
          return bot.sendMessage(chatId, `❌ IP address ${text} is already registered as "${existing.name}".`, menus.cancelButton());
        }
        state.vpsIP = text;
        state.step = 'vps_enter_user';
        return bot.sendMessage(chatId,
          `✅ IP Address: ${text}\n\n📝 Step 3/5\nPlease enter SSH username (usually 'root'):`,
          menus.cancelButton()
        );
      }

      if (state.step === 'vps_enter_user') {
        state.vpsUser = text;
        state.step = 'vps_select_auth';
        return bot.sendMessage(chatId,
          `✅ SSH User: ${esc(text)}\n\n📝 Step 4/5\nHow do you want to authenticate?`,
          menus.vpsAuthType()
        );
      }

      // Password input step
      if (state.step === 'vps_enter_password') {
        state.vpsPassword = text;

        await bot.sendMessage(chatId, '🔍 Testing SSH connection...');

        const SSHManager = require('../services/ssh');
        const ssh = new SSHManager({
          ip: state.vpsIP,
          ssh_port: 22,
          ssh_user: state.vpsUser,
          ssh_auth_type: 'password',
          ssh_password: text,
        });

        const testResult = await ssh.testConnection();
        ssh.disconnect();

        if (!testResult.success) {
          return bot.sendMessage(chatId,
            `❌ SSH connection failed:\n${testResult.error}\n\nCheck password and try again:`,
            menus.cancelButton()
          );
        }

        const vps = db.createVPS({
          name: state.vpsName,
          ip: state.vpsIP,
          ssh_user: state.vpsUser,
          ssh_auth_type: 'password',
          ssh_password: text,
          ssh_port: 22,
        });

        state.vpsId = vps.id;
        state.step = 'vps_install_dns_prompt';

        activityLogger.log({
          telegramId: userId,
          action: 'add_vps',
          resourceType: 'vps',
          resourceId: vps.name,
          details: { ip: vps.ip },
        });

        return bot.sendMessage(chatId,
          `✅ SSH connection successful!\n` +
          `Hostname: ${testResult.hostname}\n\n` +
          `📝 Step 5/5\nDo you want to install PowerDNS on this VPS?\n(Required for DNS management)`,
          menus.vpsInstallDNS()
        );
      }

      // SSH Key path step
      if (state.step === 'vps_enter_key_path') {
        const keyPath = text;
        const fs = require('fs');

        if (!fs.existsSync(keyPath)) {
          return bot.sendMessage(chatId,
            `❌ File not found: ${keyPath}\n\nPlease provide a valid path to the SSH key file.`,
            menus.cancelButton()
          );
        }

        state.vpsKeyPath = keyPath;

        await bot.sendMessage(chatId, '🔍 Testing SSH connection...');

        const SSHManager = require('../services/ssh');
        const ssh = new SSHManager({
          ip: state.vpsIP,
          ssh_port: 22,
          ssh_user: state.vpsUser,
          ssh_auth_type: 'key',
          ssh_key_path: keyPath,
        });

        const testResult = await ssh.testConnection();
        ssh.disconnect();

        if (!testResult.success) {
          return bot.sendMessage(chatId,
            `❌ SSH connection failed:\n${testResult.error}\n\nPlease check your credentials and try again.`,
            menus.cancelButton()
          );
        }

        const vps = db.createVPS({
          name: state.vpsName,
          ip: state.vpsIP,
          ssh_user: state.vpsUser,
          ssh_auth_type: 'key',
          ssh_key_path: keyPath,
          ssh_port: 22,
        });

        state.vpsId = vps.id;
        state.step = 'vps_install_dns_prompt';

        activityLogger.log({
          telegramId: userId,
          action: 'add_vps',
          resourceType: 'vps',
          resourceId: vps.name,
          details: { ip: vps.ip },
        });

        return bot.sendMessage(chatId,
          `✅ SSH connection successful!\n` +
          `Hostname: ${testResult.hostname}\n\n` +
          `📝 Step 5/5\nDo you want to install PowerDNS on this VPS?\n(Required for DNS management)`,
          menus.vpsInstallDNS()
        );
      }

      // ── DOMAIN ADD FLOW ──

      if (state.step === 'domain_enter_name') {
        const domain = Validator.sanitizeDomain(text);

        if (!Validator.isValidDomain(domain)) {
          return bot.sendMessage(chatId,
            `❌ Invalid domain format: "${text}"\n\nPlease enter a valid domain (e.g. example.com):`,
            menus.cancelButton()
          );
        }

        // Check if already exists
        const existing = db.getDomainByName(domain);
        if (existing) {
          return bot.sendMessage(chatId,
            `❌ Domain <b>${domain}</b> is already registered in the system.`,
            { parse_mode: 'HTML', ...menus.cancelButton() }
          );
        }

        state.domain = domain;
        state.step = 'domain_select_vps';

        // Show VPS selection
        const vpsList = db.getActiveVPS();

        if (vpsList.length === 1) {
          // Auto-select if only one VPS
          const vps = vpsList[0];
          state.step = 'domain_select_vps';

          // Trigger VPS selection directly
          const domainRow = db.createDomain({
            domain,
            vps_id: vps.id,
            ns1: config.dns.ns1,
            ns2: config.dns.ns2,
            created_by: String(userId),
          });

          state.step = 'domain_ns_pending';
          state.domainId = domainRow.id;
          state.vpsId = vps.id;

          return bot.sendMessage(chatId,
            `✅ Domain: <b>${domain}</b>\n` +
            `✅ VPS: ${vps.name}\n\n` +
            `📋 <b>NAMESERVER CONFIGURATION</b>\n\n` +
            `Update nameservers at your registrar:\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `NS1: <code>${config.dns.ns1}</code>\n` +
            `NS2: <code>${config.dns.ns2}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📖 Steps:\n` +
            `1. Login to your domain registrar\n` +
            `2. Find "DNS Settings" or "Nameservers"\n` +
            `3. Select "Custom Nameservers"\n` +
            `4. Enter the NS records above\n` +
            `5. Save changes\n\n` +
            `⏱️ Propagation: 5 min to 48 hours`,
            { parse_mode: 'HTML', ...menus.nsConfigured() }
          );
        }

        let vpsText = `✅ Domain: <b>${domain}</b>\n\nSelect VPS for hosting:\n\n`;
        for (let i = 0; i < vpsList.length; i++) {
          const vps = vpsList[i];
          const domainCount = db.getVPSDomainCount(vps.id);
          vpsText += `${i + 1}️⃣ <b>${vps.name}</b> (${vps.ip})\n   Domains: ${domainCount} | Status: 🟢 Active\n\n`;
        }

        return bot.sendMessage(chatId, vpsText, {
          parse_mode: 'HTML',
          ...menus.vpsSelectList(vpsList),
        });
      }

      // ── SUBDOMAIN ADD FLOW ──

      if (state.step === 'subdomain_enter_name') {
        const subdomain = Validator.sanitizeSubdomain(text);

        if (!Validator.isValidSubdomain(subdomain)) {
          return bot.sendMessage(chatId,
            `❌ Invalid subdomain: "${text}"\n\n` +
            `Use only letters, numbers, and hyphens.\n` +
            `Reserved names (www, mail, ftp, etc.) are not allowed.`,
            menus.cancelButton()
          );
        }

        const fullDomain = `${subdomain}.${state.parentDomain}`;

        // Check if already exists
        const existing = db.getSubdomainByFullDomain(fullDomain);
        if (existing) {
          return bot.sendMessage(chatId,
            `❌ Subdomain <b>${fullDomain}</b> already exists.`,
            { parse_mode: 'HTML', ...menus.cancelButton() }
          );
        }

        state.subdomain = subdomain;
        state.fullDomain = fullDomain;
        state.step = 'subdomain_upload_zip';

        return bot.sendMessage(chatId,
          `✅ Subdomain: <b>${fullDomain}</b>\n\n` +
          `This will create a NEW, SEPARATE website at:\nhttps://${fullDomain}\n\n` +
          `📦 <b>Website Upload</b>\n\n` +
          `Please send a ZIP archive for this subdomain.\n\n` +
          `⚠️ IMPORTANT:\n` +
          `This is SEPARATE from ${state.parentDomain}\n` +
          `Each subdomain has its own files.\n\n` +
          `Location: <code>/var/www/${fullDomain}/</code>`,
          { parse_mode: 'HTML', ...menus.cancelButton() }
        );
      }

      // ── TEAM ADD FLOW ──

      if (state.step === 'team_enter_id') {
        const telegramId = text.replace('@', '').trim();

        if (!Validator.isValidTelegramId(telegramId)) {
          return bot.sendMessage(chatId,
            `❌ Invalid Telegram User ID.\n\nPlease enter a numeric user ID (e.g. 123456789):`,
            menus.cancelButton()
          );
        }

        // Check if already exists
        const existing = db.getUserByTelegramId(telegramId);
        if (existing) {
          delete bot._userStates[userId];
          return bot.sendMessage(chatId,
            `❌ User with ID ${telegramId} is already a team member.`,
            menus.adminTeam()
          );
        }

        state.pendingTelegramId = telegramId;
        state.step = 'team_select_role';

        const text2 =
          `✅ User ID: <code>${telegramId}</code>\n\n` +
          `Select Role:\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>MEMBER</b>\n` +
          `Can: Add domains, manage own domains, create subdomains, upload sites\n` +
          `Cannot: Manage VPS, team, view logs, delete others' domains\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👑 <b>ADMIN</b>\n` +
          `Full system access: VPS, team, logs, all domains`;

        return bot.sendMessage(chatId, text2, {
          parse_mode: 'HTML',
          ...menus.teamRoleSelect(telegramId),
        });
      }

    } catch (err) {
      logger.error('Error in text message handler', { userId, step: state?.step, error: err.message });
      bot.sendMessage(chatId, `❌ An error occurred: ${err.message}`, menus.backToMain());
    }
  });

  // ────────────────────────────────────────────────────
  // DOCUMENT (ZIP FILE) HANDLER
  // Handles file uploads for domain/subdomain deployment
  // ────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.document) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const state = bot._userStates[userId];
    if (!state) return;

    const access = await auth.checkAccess(msg);
    if (!access.allowed) return bot.sendMessage(chatId, access.reason);

    const doc = msg.document;
    const fileName = doc.file_name || 'upload.zip';

    // Validate it's a ZIP
    if (!fileName.toLowerCase().endsWith('.zip')) {
      return bot.sendMessage(chatId,
        `❌ Please send a ZIP file (.zip).\nReceived: ${fileName}`,
        menus.cancelButton()
      );
    }

    // Check size
    const sizeMB = doc.file_size / (1024 * 1024);
    if (sizeMB > config.upload.maxSizeMB) {
      return bot.sendMessage(chatId,
        `❌ File too large: ${sizeMB.toFixed(1)} MB\nMaximum: ${config.upload.maxSizeMB} MB`,
        menus.cancelButton()
      );
    }

    try {
      // ── DOMAIN DEPLOY (new domain) ──
      if (state.step === 'domain_upload_zip') {
        const domain = state.domain;
        const domainId = state.domainId;

        await bot.sendMessage(chatId,
          `📥 Downloading: ${fileName}\nSize: ${sizeMB.toFixed(1)} MB`
        );

        const zipPath = await fileManager.downloadTelegramFile(bot, doc.file_id, fileName);

        const statusMsg = await bot.sendMessage(chatId,
          `🚀 Deploying ${domain}...\n\nPlease wait, this may take a few minutes...`
        );

        const steps = [];
        const result = await vpsManager.deployDomain(
          { domain, vpsId: state.vpsId },
          zipPath,
          String(userId),
          (step) => steps.push(step)
        );

        delete bot._userStates[userId];

        let report = `✅ <b>DEPLOYMENT SUCCESSFUL!</b>\n\n`;
        report += `🎉 Your website is now LIVE!\n\n`;
        report += `🌐 Domain: <b>${domain}</b>\n`;
        report += `🔒 HTTPS: ${result.sslActive ? '✅ Active' : '⚠️ Pending'}\n`;
        report += `📁 Location: <code>${result.site_path}</code>\n`;
        report += `📊 Files: ${result.fileCount} files, ${FileManager.formatSize(result.totalSize)}\n\n`;
        report += `🔗 Access your site:\n`;
        report += `• https://${domain}\n`;
        report += `• https://www.${domain}\n\n`;
        report += `Progress:\n`;
        report += steps.map(s => `[✓] ${s}`).join('\n');

        await bot.sendMessage(chatId, report, {
          parse_mode: 'HTML',
          ...menus.afterDomainDeploy(domainId),
        });
        return;
      }

      // ── DOMAIN UPDATE FILES ──
      if (state.step === 'domain_update_zip') {
        const domainId = state.domainId;
        const domain = state.domain;

        await bot.sendMessage(chatId, `📥 Downloading: ${fileName}`);

        const zipPath = await fileManager.downloadTelegramFile(bot, doc.file_id, fileName);

        await bot.sendMessage(chatId, `🔄 Updating files for ${domain}...`);

        const steps = [];
        const result = await vpsManager.updateDomainFiles(
          domainId, zipPath, String(userId),
          (step) => steps.push(step)
        );

        delete bot._userStates[userId];

        let report = `✅ <b>FILES UPDATED</b>\n\n`;
        report += `🌐 Domain: <b>${domain}</b>\n`;
        report += `📊 Files: ${result.fileCount} files, ${FileManager.formatSize(result.totalSize)}\n\n`;
        report += `Progress:\n`;
        report += steps.map(s => `[✓] ${s}`).join('\n');

        await bot.sendMessage(chatId, report, {
          parse_mode: 'HTML',
          ...menus.domainManage(domainId),
        });
        return;
      }

      // ── SUBDOMAIN DEPLOY (new subdomain) ──
      if (state.step === 'subdomain_upload_zip') {
        const fullDomain = state.fullDomain;
        const subdomain = state.subdomain;
        const domainId = state.domainId;

        await bot.sendMessage(chatId,
          `📥 Downloading: ${fileName}\nSize: ${sizeMB.toFixed(1)} MB`
        );

        const zipPath = await fileManager.downloadTelegramFile(bot, doc.file_id, fileName);

        await bot.sendMessage(chatId,
          `🚀 Deploying ${fullDomain}...\n\nPlease wait...`
        );

        const steps = [];
        const result = await vpsManager.deploySubdomain(
          { subdomain, domainId, fullDomain },
          zipPath,
          String(userId),
          (step) => steps.push(step)
        );

        delete bot._userStates[userId];

        let report = `✅ <b>SUBDOMAIN DEPLOYED!</b>\n\n`;
        report += `🌐 Subdomain: <b>${fullDomain}</b>\n`;
        report += `🔒 HTTPS: ${result.sslActive ? '✅ Active' : '⚠️ Pending'}\n`;
        report += `📁 Location: <code>${result.site_path}</code>\n`;
        report += `📊 Files: ${result.fileCount} files, ${FileManager.formatSize(result.totalSize)}\n\n`;
        report += `🔗 Access: https://${fullDomain}\n\n`;
        report += `Progress:\n`;
        report += steps.map(s => `[✓] ${s}`).join('\n');

        await bot.sendMessage(chatId, report, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add Another Subdomain', callback_data: `subdomain_add_${domainId}` }],
              [{ text: `📋 Manage ${state.parentDomain}`, callback_data: `domain_manage_${domainId}` }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
            ],
          },
        });
        return;
      }

      // ── SUBDOMAIN UPDATE FILES ──
      if (state.step === 'subdomain_update_zip') {
        const subdomainId = state.subdomainId;
        const fullDomain = state.fullDomain;

        await bot.sendMessage(chatId, `📥 Downloading: ${fileName}`);

        const zipPath = await fileManager.downloadTelegramFile(bot, doc.file_id, fileName);

        await bot.sendMessage(chatId, `🔄 Updating files for ${fullDomain}...`);

        const steps = [];
        const result = await vpsManager.updateSubdomainFiles(
          subdomainId, zipPath, String(userId),
          (step) => steps.push(step)
        );

        delete bot._userStates[userId];

        const subdomain = db.getSubdomain(subdomainId);

        let report = `✅ <b>FILES UPDATED</b>\n\n`;
        report += `🌐 Subdomain: <b>${fullDomain}</b>\n`;
        report += `📊 Files: ${result.fileCount} files, ${FileManager.formatSize(result.totalSize)}\n\n`;
        report += `Progress:\n`;
        report += steps.map(s => `[✓] ${s}`).join('\n');

        await bot.sendMessage(chatId, report, {
          parse_mode: 'HTML',
          ...menus.subdomainManage(subdomainId, subdomain ? subdomain.domain_id : null),
        });
        return;
      }

    } catch (err) {
      logger.error('Error in document handler', { userId, step: state?.step, error: err.message });
      delete bot._userStates[userId];
      bot.sendMessage(chatId, `❌ Deployment failed: ${err.message}`, menus.backToMain());
    }
  });

  // ────────────────────────────────────────────────────
  // SSH KEY FILE UPLOAD (for VPS setup)
  // ────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.document) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = bot._userStates[userId];

    // Only handle if user is in VPS key upload step
    if (!state || state.step !== 'vps_upload_key') return;

    const doc = msg.document;
    const fileName = doc.file_name || 'ssh_key';

    try {
      const zipPath = await fileManager.downloadTelegramFile(bot, doc.file_id, fileName);

      // Use the downloaded file as the SSH key
      state.vpsKeyPath = zipPath;

      // Continue to SSH test step
      await bot.sendMessage(chatId, '🔍 Testing SSH connection...');

      const SSHManager = require('../services/ssh');
      const ssh = new SSHManager({
        ip: state.vpsIP,
        ssh_port: 22,
        ssh_user: state.vpsUser,
        ssh_key_path: zipPath,
      });

      const testResult = await ssh.testConnection();
      ssh.disconnect();

      if (!testResult.success) {
        return bot.sendMessage(chatId,
          `❌ SSH connection failed:\n${testResult.error}`,
          menus.cancelButton()
        );
      }

      const vps = db.createVPS({
        name: state.vpsName,
        ip: state.vpsIP,
        ssh_user: state.vpsUser,
        ssh_key_path: zipPath,
        ssh_port: 22,
      });

      state.vpsId = vps.id;
      state.step = 'vps_install_dns_prompt';

      activityLogger.log({
        telegramId: userId,
        action: 'add_vps',
        resourceType: 'vps',
        resourceId: vps.name,
      });

      return bot.sendMessage(chatId,
        `✅ SSH connection successful!\nHostname: ${testResult.hostname}\n\n` +
        `Do you want to install PowerDNS on this VPS?\n(Required for DNS management)`,
        menus.vpsInstallDNS()
      );
    } catch (err) {
      logger.error('SSH key upload failed', { error: err.message });
      bot.sendMessage(chatId, `❌ Failed to process SSH key: ${err.message}`, menus.cancelButton());
    }
  });

  // ────────────────────────────────────────────────────
  // GLOBAL ERROR HANDLERS
  // ────────────────────────────────────────────────────
  bot.on('polling_error', (error) => {
    logger.error('Telegram polling error', { error: error.message });
  });

  bot.on('error', (error) => {
    logger.error('Telegram bot error', { error: error.message });
  });

  logger.info('Bot initialized with all handlers');
  return bot;
}

module.exports = { createBot };
