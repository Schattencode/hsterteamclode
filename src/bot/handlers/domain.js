const menus = require('../keyboards/menus');
const Validator = require('../../utils/validator');
const FileManager = require('../../services/fileManager');
const logger = require('../../utils/logger');

/**
 * Register all domain management handlers.
 */
function registerDomainHandlers(bot, db, auth, activityLogger, vpsManager, config) {

  // ────────────────────────────────────────────
  // List all domains
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'domains_list') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAccess(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const isAdmin = access.user.role === 'admin';
    const domains = isAdmin
      ? db.getAllDomains()
      : db.getDomainsByUser(String(query.from.id));

    if (domains.length === 0) {
      return bot.editMessageText(
        '📋 *Your Domains*\n\nNo domains configured yet.',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add New Domain', callback_data: 'domain_add' }],
              [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
            ],
          },
        }
      );
    }

    let text = `📋 *YOUR DOMAINS*\n\nTotal: ${domains.length} domains\n`;

    const keyboard = [];
    for (const d of domains) {
      const subs = db.getSubdomainsByDomain(d.id);
      const sslIcon = d.ssl_status === 'active' ? '✅' : '⚠️';
      const statusIcon = d.status === 'active' ? '🟢' : '🔴';

      text += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🌐 *${d.domain}*\n`;
      text += `🔒 SSL: ${sslIcon} | ${statusIcon} ${d.status}\n`;
      text += `📂 Subdomains: ${subs.length}`;
      if (subs.length > 0) {
        text += '\n' + subs.map(s => `   • ${s.full_domain}`).join('\n');
      }

      keyboard.push([
        { text: `📋 Manage ${d.domain}`, callback_data: `domain_manage_${d.id}` },
      ]);
    }

    keyboard.push([{ text: '➕ Add New Domain', callback_data: 'domain_add' }]);
    keyboard.push([{ text: '🏠 Main Menu', callback_data: 'main_menu' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Manage single domain (detail view)
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_manage_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) {
      return bot.answerCallbackQuery(query.id, { text: access.reason, show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    if (!domain) {
      return bot.editMessageText('Domain not found.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...menus.backToMain(),
      });
    }

    const subs = db.getSubdomainsByDomain(domainId);
    const vps = db.getVPS(domain.vps_id);

    let text = `📋 *DOMAIN: ${domain.domain}*\n\n`;
    text += `━━━ 📊 OVERVIEW ━━━\n\n`;
    text += `🌐 Domain: ${domain.domain}\n`;
    text += `🖥️ VPS: ${vps ? vps.name : 'Unknown'} (${vps ? vps.ip : 'N/A'})\n`;
    text += `📁 Path: \`${domain.site_path || 'Not deployed'}\`\n`;
    text += `🔒 SSL: ${domain.ssl_status === 'active' ? '✅ Active' : '⚠️ ' + domain.ssl_status}\n`;
    if (domain.ssl_expiry) text += `📅 SSL Expiry: ${domain.ssl_expiry}\n`;
    text += `📊 Status: ${domain.status === 'active' ? '🟢 Online' : '🔴 ' + domain.status}\n`;
    text += `⏰ Created: ${domain.created_at}\n`;

    if (subs.length > 0) {
      text += `\n━━━ 📂 SUBDOMAINS (${subs.length}) ━━━\n\n`;
      for (const s of subs) {
        const sslIcon = s.ssl_status === 'active' ? '✅' : '⚠️';
        text += `• ${s.full_domain}\n  📁 ${s.site_path || 'N/A'} | 🔒 ${sslIcon}\n`;
      }
    }

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...menus.domainManage(domainId),
    });
  });

  // ────────────────────────────────────────────
  // View subdomains for a domain
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_subs_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const subs = db.getSubdomainsByDomain(domainId);

    if (subs.length === 0) {
      return bot.editMessageText(
        `📂 *Subdomains of ${domain.domain}*\n\nNo subdomains yet.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add Subdomain', callback_data: `subdomain_add_${domainId}` }],
              [{ text: '⬅️ Back', callback_data: `domain_manage_${domainId}` }],
            ],
          },
        }
      );
    }

    let text = `📂 *Subdomains of ${domain.domain}* (${subs.length})\n\n`;
    const keyboard = [];

    for (const s of subs) {
      const sslIcon = s.ssl_status === 'active' ? '✅' : '⚠️';
      text += `🌐 *${s.full_domain}*\n`;
      text += `📁 ${s.site_path || 'N/A'}\n`;
      text += `🔒 SSL: ${sslIcon} | 📊 ${s.status === 'active' ? '🟢' : '🔴'}\n\n`;

      keyboard.push([
        { text: `🔧 Manage ${s.subdomain}`, callback_data: `subdomain_manage_${s.id}` },
      ]);
    }

    keyboard.push([{ text: '➕ Add Subdomain', callback_data: `subdomain_add_${domainId}` }]);
    keyboard.push([{ text: '⬅️ Back', callback_data: `domain_manage_${domainId}` }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Add domain — Step 1: ask for domain name
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'domain_add') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAccess(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    // Check there's at least one VPS
    const vpsList = db.getActiveVPS();
    if (vpsList.length === 0) {
      return bot.editMessageText(
        '❌ No VPS servers configured. An admin needs to add a VPS first.',
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.backToMain(),
        }
      );
    }

    // Set user state: waiting for domain name
    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = { step: 'domain_enter_name' };

    await bot.editMessageText(
      `🌐 *Domain Hosting Setup*\n\n` +
      `Please enter the domain name you want to host:\n\n` +
      `✅ Valid examples:\n` +
      `• example.com\n` +
      `• myproject.xyz\n` +
      `• company.co.uk\n\n` +
      `❌ Don't include:\n` +
      `• www\n` +
      `• http:// or https://\n` +
      `• Subdomains`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Add domain — Step 2: select VPS (after domain name entered via text)
  // This is handled in the text message handler in bot.js
  // ────────────────────────────────────────────

  // VPS selection for domain
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^vps_select_(\d+)$/);
    if (!match) return;

    const vpsId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    const state = (bot._userStates || {})[userId];
    if (!state || state.step !== 'domain_select_vps') return;

    await bot.answerCallbackQuery(query.id);

    const vps = db.getVPS(vpsId);
    const domain = state.domain;

    // Save domain to database
    const domainRow = db.createDomain({
      domain,
      vps_id: vpsId,
      ns1: config.dns.ns1,
      ns2: config.dns.ns2,
      created_by: String(userId),
    });

    // Update state
    state.step = 'domain_ns_pending';
    state.domainId = domainRow.id;
    state.vpsId = vpsId;

    const text =
      `✅ VPS: ${vps.name}\n\n` +
      `📋 *NAMESERVER CONFIGURATION*\n\n` +
      `To activate your domain, update nameservers at your domain registrar:\n\n` +
      `🌐 Domain: *${domain}*\n` +
      `📍 Registrar: (Namecheap, GoDaddy, Cloudflare, etc.)\n\n` +
      `Change nameservers to:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `NS1: \`${config.dns.ns1}\`\n` +
      `NS2: \`${config.dns.ns2}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📖 How to change nameservers:\n` +
      `1. Login to your domain registrar\n` +
      `2. Find "DNS Settings" or "Nameservers"\n` +
      `3. Select "Custom Nameservers"\n` +
      `4. Enter the NS records above\n` +
      `5. Save changes\n\n` +
      `⏱️ Propagation: 5 minutes to 48 hours\n` +
      `Usually completes within 1-2 hours\n\n` +
      `Once configured, click below to verify:`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...menus.nsConfigured(),
    });
  });

  // ────────────────────────────────────────────
  // Verify nameservers
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'ns_verify') return;

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    const state = (bot._userStates || {})[userId];
    if (!state || state.step !== 'domain_ns_pending') return;

    await bot.answerCallbackQuery(query.id, { text: 'Verifying nameservers...' });

    const domain = state.domain;

    await bot.editMessageText(
      `🔍 Verifying nameserver configuration for ${domain}...\n\n` +
      `This may take a moment...`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
      }
    );

    // We attempt verification but proceed even if NS haven't propagated yet,
    // since the user can still upload files and DNS will work once propagated.
    const PowerDNSManager = require('../../services/dns');
    const dnsManager = new PowerDNSManager(config.dns.apiUrl, config.dns.apiKey);
    const nsResult = await dnsManager.verifyNameservers(domain);

    let verifyText;
    if (nsResult.verified) {
      verifyText = `✅ *NAMESERVERS VERIFIED!*\n\n${domain} now points to our DNS servers.`;
      db.updateDomain(state.domainId, { ns_configured: 1 });
    } else {
      verifyText =
        `⏳ *Nameservers not detected yet.*\n\n` +
        `This is normal — DNS propagation can take up to 48 hours.\n\n` +
        `You can continue with the setup. Your site will be accessible once nameservers propagate.`;
    }

    verifyText += `\n\n📦 *Website Upload*\n\n` +
      `Please send a ZIP archive containing your website:\n\n` +
      `📋 Requirements:\n` +
      `• Must contain index.html or index.php\n` +
      `• Maximum size: ${config.upload.maxSizeMB} MB\n` +
      `• All files will be extracted to the root\n\n` +
      `💡 What to include:\n` +
      `• HTML, CSS, JS files\n` +
      `• Images, fonts, assets\n` +
      `• PHP files (if applicable)`;

    state.step = 'domain_upload_zip';

    await bot.editMessageText(verifyText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...menus.cancelButton(),
    });
  });

  // ────────────────────────────────────────────
  // Update domain files — initiate upload
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_update_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = {
      step: 'domain_update_zip',
      domainId,
      domain: domain.domain,
    };

    await bot.editMessageText(
      `🔄 *Update Site Files: ${domain.domain}*\n\n` +
      `Please send a new ZIP archive.\n\n` +
      `⚠️ This will REPLACE all existing files in:\n` +
      `\`${domain.site_path}\`\n\n` +
      `Maximum size: ${config.upload.maxSizeMB} MB`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Renew SSL
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_renew_ssl_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);

    await bot.editMessageText(
      `🔐 Renewing SSL certificate for ${domain.domain}...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    try {
      await vpsManager.renewSSL(domainId, String(query.from.id));
      await bot.editMessageText(
        `✅ SSL certificate renewed for *${domain.domain}*!`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          ...menus.domainManage(domainId),
        }
      );
    } catch (err) {
      await bot.editMessageText(
        `❌ Failed to renew SSL: ${err.message}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.domainManage(domainId),
        }
      );
    }
  });

  // ────────────────────────────────────────────
  // Delete domain — confirmation
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_delete_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const subs = db.getSubdomainsByDomain(domainId);

    let text = `⚠️ *DELETE DOMAIN*\n\n`;
    text += `You are about to delete:\n🌐 *${domain.domain}*\n\n`;
    text += `This will PERMANENTLY remove:\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🗑️ All website files\n`;
    text += `🗑️ Nginx configuration\n`;
    text += `🗑️ SSL certificate\n`;
    text += `🗑️ DNS records\n`;
    if (subs.length > 0) {
      text += `🗑️ ${subs.length} subdomain(s) and their files\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `⚠️ THIS ACTION CANNOT BE UNDONE!`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...menus.confirmDelete('domain', domainId),
    });
  });

  // ────────────────────────────────────────────
  // Delete domain — confirmed
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^confirm_delete_domain_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);

    await bot.editMessageText(
      `🗑️ Deleting ${domain.domain}...\n\nPlease wait...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    try {
      const steps = [];
      await vpsManager.deleteDomain(domainId, String(query.from.id), (step) => {
        steps.push(step);
      });

      let report = `✅ *DOMAIN DELETED*\n\n`;
      report += `${domain.domain} has been completely removed.\n\n`;
      report += `Progress:\n`;
      report += steps.map(s => `[✓] ${s}`).join('\n');

      await bot.editMessageText(report, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...menus.backToMain(),
      });
    } catch (err) {
      logger.error('Domain deletion failed', { domainId, error: err.message });
      await bot.editMessageText(
        `❌ Failed to delete domain: ${err.message}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.backToMain(),
        }
      );
    }
  });
}

module.exports = { registerDomainHandlers };
