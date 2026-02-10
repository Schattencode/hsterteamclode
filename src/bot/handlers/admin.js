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
  // VPS Auth Type — Password
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_auth_password') return;

    const chatId = query.message.chat.id;
    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[query.from.id];
    if (!state || state.step !== 'vps_select_auth') return;

    state.step = 'vps_enter_password';
    state.authType = 'password';

    await bot.editMessageText(
      `🔑 <b>VPS Setup — Enter Password</b>\n\n` +
      `Please enter the SSH password for <b>${state.vpsUser}@${state.vpsIP}</b>:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // VPS Auth Type — SSH Key
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_auth_key') return;

    const chatId = query.message.chat.id;
    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[query.from.id];
    if (!state || state.step !== 'vps_select_auth') return;

    state.step = 'vps_enter_key_path';
    state.authType = 'key';

    await bot.editMessageText(
      `🔐 <b>VPS Setup — SSH Key</b>\n\n` +
      `Please send the absolute path to your SSH private key on the bot server:\n\n` +
      `Example: /root/.ssh/id_rsa`,
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

    const authIcon = vps.ssh_auth_type === 'key' ? '🔐 SSH Key' : '🔑 Password';

    const text =
      `🖥️ <b>VPS: ${vps.name}</b>\n\n` +
      `🌐 IP: ${vps.ip}\n` +
      `👤 SSH User: ${vps.ssh_user}\n` +
      `🔒 Auth: ${authIcon}\n` +
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
  // Install Nginx on VPS (after SSH test)
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'vps_install_nginx') return;

    const chatId = query.message.chat.id;
    const userId = query.from.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[userId];
    if (!state || !state.vpsId) return;

    const vps = db.getVPS(state.vpsId);

    const msgId = query.message.message_id;

    const updateMsg = async (text) => {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' });
      } catch { /* ignore edit errors */ }
    };

    await updateMsg(
      `📦 <b>Setting up ${vps.name}...</b>\n\n` +
      `⏳ Installing web server stack...\n` +
      `This may take 3-5 minutes...`
    );

    try {
      const SSHManager = require('../../services/ssh');
      const VPSInstaller = require('../../services/installer');

      const ssh = new SSHManager(vps);
      await ssh.connect();

      const installer = new VPSInstaller(ssh);
      const result = await installer.provisionWebServer(async (step) => {
        await updateMsg(
          `📦 <b>Setting up ${vps.name}...</b>\n\n` +
          `⚙️ ${step}...\n\n` +
          `⏳ Please wait...`
        );
      });

      ssh.disconnect();

      delete bot._userStates[userId];

      const cfToken = db.getSetting('cloudflare_token');
      const cfStatus = cfToken ? '✅ Configured' : '⚠️ Not configured (set in Admin Panel → Cloudflare Settings)';

      const text =
        `✅ <b>VPS SETUP COMPLETE!</b>\n\n` +
        `🖥️ VPS: ${vps.name}\n` +
        `🌐 IP: ${vps.ip}\n` +
        `🔐 SSH: Connected\n` +
        `🌍 Nginx: Installed\n` +
        `🐘 PHP: ${result.phpVersion}-FPM\n` +
        `🔒 Certbot: Installed\n` +
        `☁️ Cloudflare: ${cfStatus}\n\n` +
        `You can now add domains!`;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'HTML',
        ...menus.afterVPSSetup(state.vpsId),
      });
    } catch (err) {
      logger.error('VPS provisioning failed', { error: err.message });
      const shortErr = err.message.length > 300 ? err.message.slice(0, 300) + '...' : err.message;
      await bot.editMessageText(
        `❌ VPS setup failed:\n${shortErr}`,
        {
          chat_id: chatId,
          message_id: msgId,
          ...menus.backToMain(),
        }
      );
    }
  });

  // ────────────────────────────────────────────
  // Cloudflare Settings
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_cloudflare') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const cfToken = db.getSetting('cloudflare_token');
    const status = cfToken ? '✅ Connected' : '❌ Not configured';
    const maskedToken = cfToken ? cfToken.slice(0, 8) + '...' + cfToken.slice(-4) : 'Not set';

    const text =
      `☁️ <b>CLOUDFLARE SETTINGS</b>\n\n` +
      `Status: ${status}\n` +
      `Token: <code>${maskedToken}</code>\n\n` +
      `Cloudflare manages DNS for all your domains.\n` +
      `Each domain gets unique nameservers automatically.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: cfToken ? '🔄 Update API Token' : '🔑 Set API Token', callback_data: 'cf_set_token' }],
          [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
        ],
      },
    });
  });

  // Start Cloudflare token input flow
  bot.on('callback_query', async (query) => {
    if (query.data !== 'cf_set_token') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = { step: 'cf_enter_token' };

    await bot.editMessageText(
      `🔑 <b>Enter Cloudflare API Token</b>\n\n` +
      `To get your token:\n` +
      `1. Go to dash.cloudflare.com\n` +
      `2. My Profile → API Tokens\n` +
      `3. Create Token → "Edit zone DNS" template\n` +
      `4. Zone Resources: Include → All Zones\n` +
      `5. Create Token and copy it\n\n` +
      `Paste the token below:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.cancelButton(),
      }
    );
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
