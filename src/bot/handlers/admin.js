const menus = require('../keyboards/menus');
const FileManager = require('../../services/fileManager');
const logger = require('../../utils/logger');

/**
 * Register admin panel handlers: VPS management, stats, logs.
 */
function registerAdminHandlers(bot, db, auth, activityLogger, config) {

  // ────────────────────────────────────────────
  // Admin panel
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_panel') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) {
      return bot.answerCallbackQuery(query.id, { text: access.reason, show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const stats = db.getStats();
    const vpsList = db.getAllVPS();
    const users = db.getAllUsers();

    const admins = users.filter(u => u.role === 'admin');
    const members = users.filter(u => u.role === 'member');

    let text = `⚙️ <b>ADMIN PANEL</b>\n\n`;
    text += `━━━ 🖥️ VPS ━━━\n`;
    text += `Total: ${vpsList.length} | Active: ${vpsList.filter(v => v.status === 'active').length}\n\n`;
    text += `━━━ 👥 TEAM ━━━\n`;
    text += `Admins: ${admins.length} | Members: ${members.length}\n\n`;
    text += `━━━ 📊 STATS ━━━\n`;
    text += `Domains: ${stats.domains}\n`;
    text += `Subdomains: ${stats.subdomains}\n`;
    text += `Total Sites: ${stats.totalSites}\n`;
    text += `SSL Certificates: ${stats.activeSsl} active`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.adminPanel(),
    });
  });

  // ────────────────────────────────────────────
  // VPS Management submenu
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_vps') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    await bot.editMessageText(
      `🖥️ <b>VPS Management</b>\n\nManage your VPS servers.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.adminVPS(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Add VPS — Step 1: ask for name
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_add') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = { step: 'vps_enter_name' };

    await bot.editMessageText(
      `📝 <b>VPS Setup — Step 1/4</b>\n\n` +
      `Please enter a name for this VPS:\n` +
      `Example: Main Server, Production, Staging`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // List VPS
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_list') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const vpsList = db.getAllVPS();

    if (vpsList.length === 0) {
      return bot.editMessageText(
        `🖥️ <b>VPS Servers</b>\n\nNo VPS servers configured.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add VPS', callback_data: 'vps_add' }],
              [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
            ],
          },
        }
      );
    }

    let text = `🖥️ <b>VPS SERVERS</b> (${vpsList.length})\n\n`;
    const keyboard = [];

    for (const vps of vpsList) {
      const domainCount = db.getVPSDomainCount(vps.id);
      const statusIcon = vps.status === 'active' ? '🟢' : '🔴';
      const dnsIcon = vps.dns_configured ? '✅' : '❌';

      text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `<b>${vps.name}</b>\n`;
      text += `🌐 IP: ${vps.ip}\n`;
      text += `📊 Status: ${statusIcon} ${vps.status}\n`;
      text += `🌍 DNS: ${dnsIcon}\n`;
      text += `🌐 Domains: ${domainCount}\n\n`;

      keyboard.push([
        { text: `🔧 Manage ${vps.name}`, callback_data: `vps_manage_${vps.id}` },
      ]);
    }

    keyboard.push([{ text: '➕ Add VPS', callback_data: 'vps_add' }]);
    keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_panel' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Manage VPS detail
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^vps_manage_(\d+)$/);
    if (!match) return;

    const vpsId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const vps = db.getVPS(vpsId);
    if (!vps) {
      return bot.editMessageText('VPS not found.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...menus.backToMain(),
      });
    }

    const domainCount = db.getVPSDomainCount(vpsId);

    const text =
      `🖥️ <b>VPS: ${vps.name}</b>\n\n` +
      `🌐 IP: ${vps.ip}\n` +
      `👤 SSH User: ${vps.ssh_user}\n` +
      `🔑 SSH Port: ${vps.ssh_port}\n` +
      `🌍 DNS: ${vps.dns_configured ? '✅ Configured' : '❌ Not configured'}\n` +
      `📊 Status: ${vps.status}\n` +
      `🌐 Domains: ${domainCount}\n` +
      `⏰ Added: ${vps.created_at}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.vpsManage(vpsId),
    });
  });

  // ────────────────────────────────────────────
  // VPS domains list
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^vps_domains_(\d+)$/);
    if (!match) return;

    const vpsId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const vps = db.getVPS(vpsId);
    const domains = db.getDomainsByVPS(vpsId);

    if (domains.length === 0) {
      return bot.editMessageText(
        `📋 <b>Domains on ${vps.name}</b>\n\nNo domains hosted on this VPS.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Back', callback_data: `vps_manage_${vpsId}` }],
            ],
          },
        }
      );
    }

    let text = `📋 <b>Domains on ${vps.name}</b> (${domains.length})\n\n`;
    const keyboard = [];

    for (const d of domains) {
      text += `• ${d.domain} (${d.ssl_status === 'active' ? '🔒' : '⚠️'})\n`;
      keyboard.push([
        { text: `📋 ${d.domain}`, callback_data: `domain_manage_${d.id}` },
      ]);
    }

    keyboard.push([{ text: '⬅️ Back', callback_data: `vps_manage_${vpsId}` }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Delete VPS — confirmation
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^vps_delete_(\d+)$/);
    if (!match) return;

    const vpsId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const vps = db.getVPS(vpsId);
    const domainCount = db.getVPSDomainCount(vpsId);

    if (domainCount > 0) {
      return bot.editMessageText(
        `❌ Cannot remove VPS <b>${vps.name}</b>.\n\n` +
        `It still has ${domainCount} domain(s) hosted. Remove all domains first.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          ...menus.vpsManage(vpsId),
        }
      );
    }

    await bot.editMessageText(
      `⚠️ <b>DELETE VPS</b>\n\n` +
      `Remove <b>${vps.name}</b> (${vps.ip}) from bot?\n\n` +
      `This only removes the VPS record from the bot.\nThe actual server will not be affected.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.confirmDelete('vps', vpsId),
      }
    );
  });

  // Confirm VPS deletion
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^confirm_delete_vps_(\d+)$/);
    if (!match) return;

    const vpsId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const vps = db.getVPS(vpsId);
    db.deleteVPS(vpsId);

    activityLogger.log({
      telegramId: query.from.id,
      action: 'delete_vps',
      resourceType: 'vps',
      resourceId: vps.name,
    });

    await bot.editMessageText(
      `✅ VPS <b>${vps.name}</b> has been removed.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.adminVPS(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Install PowerDNS on VPS
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_install_dns') return;

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[userId];
    if (!state || !state.vpsId) return;

    const vps = db.getVPS(state.vpsId);

    await bot.editMessageText(
      `📦 Installing PowerDNS on ${vps.name}...\n\nThis may take a few minutes...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    try {
      const SSHManager = require('../../services/ssh');
      const PowerDNSInstaller = require('../../services/installer');

      const ssh = new SSHManager(vps);
      await ssh.connect();

      const installer = new PowerDNSInstaller(ssh);

      // Install Nginx first
      await installer.installNginx();

      // Install PowerDNS
      const result = await installer.install();

      // Update VPS record
      db.updateVPS(state.vpsId, { dns_configured: 1 });

      ssh.disconnect();

      delete bot._userStates[userId];

      const text =
        `✅ <b>VPS SETUP COMPLETE!</b>\n\n` +
        `🖥️ VPS: ${vps.name}\n` +
        `🌐 IP: ${vps.ip}\n` +
        `🔐 SSH: Connected\n` +
        `🌍 DNS: Active\n\n` +
        `Your nameservers:\n` +
        `NS1: <code>${config.dns.ns1}</code> (${vps.ip})\n` +
        `NS2: <code>${config.dns.ns2}</code> (${vps.ip})`;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.afterVPSSetup(state.vpsId),
      });
    } catch (err) {
      logger.error('PowerDNS installation failed', { error: err.message });
      await bot.editMessageText(
        `❌ PowerDNS installation failed:\n${err.message}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.backToMain(),
        }
      );
    }
  });

  // Skip DNS installation
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_skip_dns') return;

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[userId];
    if (!state || !state.vpsId) return;

    const vps = db.getVPS(state.vpsId);
    delete bot._userStates[userId];

    const text =
      `✅ <b>VPS Added!</b>\n\n` +
      `🖥️ VPS: ${vps.name}\n` +
      `🌐 IP: ${vps.ip}\n` +
      `🔐 SSH: Connected\n` +
      `🌍 DNS: Skipped\n\n` +
      `You can install PowerDNS later from VPS settings.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.afterVPSSetup(state.vpsId),
    });
  });

  // ────────────────────────────────────────────
  // Statistics
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_stats') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const stats = db.getStats();

    const text =
      `📊 <b>DETAILED STATISTICS</b>\n\n` +
      `━━━ Infrastructure ━━━\n` +
      `🖥️ VPS Servers: ${stats.vps}\n` +
      `🌐 Domains: ${stats.domains}\n` +
      `📂 Subdomains: ${stats.subdomains}\n` +
      `📄 Total Sites: ${stats.totalSites}\n\n` +
      `━━━ Security ━━━\n` +
      `🔒 Active SSL: ${stats.activeSsl}\n\n` +
      `━━━ Team ━━━\n` +
      `👥 Users: ${stats.users}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
        ],
      },
    });
  });

  // ────────────────────────────────────────────
  // Activity Logs
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_logs') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const logs = db.getActivityLogs(20);

    if (logs.length === 0) {
      return bot.editMessageText(
        `📜 <b>Activity Logs</b>\n\nNo activity recorded yet.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_panel' }]],
          },
        }
      );
    }

    let text = `📜 <b>ACTIVITY LOGS</b> (last 20)\n\n`;

    for (const log of logs) {
      const icon = log.success ? '✅' : '❌';
      const time = log.created_at.split(' ').pop() || log.created_at;
      text += `${icon} <code>${log.action}</code>\n`;
      text += `   👤 ${log.user_telegram_id} | ${time}\n`;
      if (log.resource_id) text += `   📍 ${log.resource_id}\n`;
      if (log.error_message) text += `   ⚠️ ${log.error_message}\n`;
      text += `\n`;
    }

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'admin_panel' }]],
      },
    });
  });
}

module.exports = { registerAdminHandlers };
