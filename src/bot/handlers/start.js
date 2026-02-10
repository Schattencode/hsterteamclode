const menus = require('../keyboards/menus');
const logger = require('../../utils/logger');

/**
 * Register /start command and main menu handlers.
 */
function registerStartHandlers(bot, db, auth, activityLogger) {

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    activityLogger.logCommand(msg, 'start');

    const access = await auth.checkAccess(msg);
    if (!access.allowed) {
      return bot.sendMessage(chatId, access.reason);
    }

    const user = access.user;
    const isAdmin = user.role === 'admin';
    const vpsList = db.getActiveVPS();
    const domainCount = db.getDomainCount();
    const subdomainCount = db.getSubdomainCount();

    let welcomeText;

    if (vpsList.length === 0 && isAdmin) {
      // First time setup — no VPS configured yet
      welcomeText =
        `👋 Welcome to Hosting Management Bot!\n\n` +
        `You are logged in as admin.\n\n` +
        `No VPS servers configured yet. Let's set up your first VPS server.`;

      return bot.sendMessage(chatId, welcomeText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Add VPS Server', callback_data: 'vps_add' }],
            [{ text: '📖 Help', callback_data: 'help' }],
          ],
        },
      });
    }

    welcomeText =
      `👋 Welcome back, ${user.first_name || user.username || 'User'}!\n\n` +
      `📊 Quick Stats:\n` +
      `🌐 Domains: ${domainCount}\n` +
      `📂 Subdomains: ${subdomainCount}\n` +
      `🖥️ VPS Servers: ${vpsList.length}\n`;

    return bot.sendMessage(chatId, welcomeText, menus.mainMenu(isAdmin));
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    activityLogger.logCommand(msg, 'help');

    const helpText =
      `📖 <b>Hosting Management Bot — Help</b>\n\n` +
      `<b>Commands:</b>\n` +
      `/start — Main menu\n` +
      `/help — This help message\n\n` +
      `<b>Features:</b>\n` +
      `🌐 Host ANY domain with separate files\n` +
      `📂 Create unlimited subdomains (each with own files)\n` +
      `🔒 Automatic SSL certificates\n` +
      `📦 Upload ZIP archives for deployment\n` +
      `👥 Team management with roles\n\n` +
      `<b>How it works:</b>\n` +
      `1. Add a VPS server (admin)\n` +
      `2. Add a domain\n` +
      `3. Update nameservers at your registrar\n` +
      `4. Upload your website as a ZIP file\n` +
      `5. Bot configures DNS, Nginx, and SSL automatically\n\n` +
      `Each domain and subdomain gets:\n` +
      `• Its own directory (/var/www/domain)\n` +
      `• Its own Nginx configuration\n` +
      `• Its own SSL certificate\n` +
      `• Completely independent files`;

    return bot.sendMessage(chatId, helpText, {
      parse_mode: 'HTML',
      ...menus.backToMain(),
    });
  });

  // Main menu callback
  bot.on('callback_query', async (query) => {
    if (query.data !== 'main_menu') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAccess(query);
    if (!access.allowed) {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    }

    await bot.answerCallbackQuery(query.id);

    const user = access.user;
    const isAdmin = user.role === 'admin';
    const domainCount = db.getDomainCount();
    const subdomainCount = db.getSubdomainCount();
    const vpsList = db.getActiveVPS();

    const text =
      `🏠 <b>Main Menu</b>\n\n` +
      `📊 Quick Stats:\n` +
      `🌐 Domains: ${domainCount}\n` +
      `📂 Subdomains: ${subdomainCount}\n` +
      `🖥️ VPS Servers: ${vpsList.length}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.mainMenu(isAdmin),
    });
  });

  // Help callback
  bot.on('callback_query', async (query) => {
    if (query.data !== 'help') return;
    await bot.answerCallbackQuery(query.id);

    const chatId = query.message.chat.id;

    const helpText =
      `📖 <b>Help</b>\n\n` +
      `🌐 <b>Add Domain</b> — Host any domain\n` +
      `📂 <b>Manage Domains</b> — View and manage all hosted domains\n` +
      `⚙️ <b>Admin Panel</b> — VPS & team management (admin only)\n\n` +
      `Each domain/subdomain is fully independent with its own files, Nginx config, and SSL certificate.`;

    await bot.editMessageText(helpText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.backToMain(),
    });
  });

  // Cancel callback — return to main menu
  bot.on('callback_query', async (query) => {
    if (query.data !== 'cancel') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAccess(query);
    await bot.answerCallbackQuery(query.id);

    // Clear any pending state for this user
    if (bot._userStates) {
      delete bot._userStates[query.from.id];
    }

    const isAdmin = access.allowed && access.user.role === 'admin';

    await bot.editMessageText('❌ Action cancelled.', {
      chat_id: chatId,
      message_id: query.message.message_id,
      ...menus.mainMenu(isAdmin),
    });
  });
}

module.exports = { registerStartHandlers };
