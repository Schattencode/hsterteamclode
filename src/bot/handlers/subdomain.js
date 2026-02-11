const menus = require('../keyboards/menus');
const Validator = require('../../utils/validator');
const logger = require('../../utils/logger');

/**
 * Register all subdomain management handlers.
 */
function registerSubdomainHandlers(bot, db, auth, activityLogger, vpsManager, config) {

  // ────────────────────────────────────────────
  // Add subdomain — Step 1: ask for subdomain name
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^subdomain_add_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId, 'edit');
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: access.reason || 'Access denied', show_alert: true });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = {
      step: 'subdomain_enter_name',
      domainId,
      parentDomain: domain.domain,
    };

    await bot.editMessageText(
      `➕ <b>New Subdomain for ${domain.domain}</b>\n\n` +
      `Please enter the subdomain name:\n\n` +
      `✅ Valid examples:\n` +
      `• app\n` +
      `• api\n` +
      `• blog\n` +
      `• admin\n\n` +
      `❌ Don't include:\n` +
      `• The main domain (${domain.domain})\n` +
      `• Special characters (!@#$%)\n` +
      `• Spaces\n\n` +
      `The full domain will be: subdomain.${domain.domain}`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Manage subdomain detail view
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^subdomain_manage_(\d+)$/);
    if (!match) return;

    const subdomainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    await bot.answerCallbackQuery(query.id);

    const subdomain = db.getSubdomain(subdomainId);
    if (!subdomain) {
      return bot.editMessageText('Subdomain not found.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...menus.backToMain(),
      });
    }

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id);
    if (!access.allowed) return;

    const sslIcon = subdomain.ssl_status === 'active' ? '✅ Active' : '⚠️ ' + subdomain.ssl_status;

    const text =
      `🔧 <b>SUBDOMAIN: ${subdomain.full_domain}</b>\n\n` +
      `📁 Path: <code>${subdomain.site_path || 'N/A'}</code>\n` +
      `🔒 SSL: ${sslIcon}\n` +
      `📊 Status: ${subdomain.status === 'active' ? '🟢 Online' : '🔴 ' + subdomain.status}\n` +
      `⏰ Created: ${subdomain.created_at}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.subdomainManage(subdomainId, subdomain.domain_id),
    });
  });

  // ────────────────────────────────────────────
  // Update subdomain files — initiate upload
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^subdomain_update_(\d+)$/);
    if (!match) return;

    const subdomainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    await bot.answerCallbackQuery(query.id);

    const subdomain = db.getSubdomain(subdomainId);
    if (!subdomain) return;

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id, 'edit');
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: access.reason || 'Access denied', show_alert: true });

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = {
      step: 'subdomain_update_zip',
      subdomainId,
      fullDomain: subdomain.full_domain,
    };

    await bot.editMessageText(
      `🔄 <b>Update Site Files: ${subdomain.full_domain}</b>\n\n` +
      `Please send a new ZIP archive.\n\n` +
      `⚠️ This will REPLACE all existing files in:\n` +
      `<code>${subdomain.site_path}</code>\n\n` +
      `Maximum size: ${config.upload.maxSizeMB} MB`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Renew SSL for subdomain
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^subdomain_renew_ssl_(\d+)$/);
    if (!match) return;

    const subdomainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    await bot.answerCallbackQuery(query.id);

    const subdomain = db.getSubdomain(subdomainId);
    if (!subdomain) return;

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id, 'edit');
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: access.reason || 'Access denied', show_alert: true });

    await bot.editMessageText(
      `🔐 Obtaining SSL certificate for ${subdomain.full_domain}...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    try {
      const result = await vpsManager.renewSubdomainSSL(subdomainId, String(query.from.id));
      const expiryText = result.expiry ? `\nExpiry: ${result.expiry}` : '';
      await bot.editMessageText(
        `✅ SSL certificate active for <b>${subdomain.full_domain}</b>!${expiryText}\n\n🔒 https://${subdomain.full_domain}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          ...menus.subdomainManage(subdomainId, subdomain.domain_id),
        }
      );
    } catch (err) {
      const shortErr = err.message.length > 300 ? err.message.slice(0, 300) + '...' : err.message;
      await bot.editMessageText(
        `❌ Failed to obtain SSL: ${shortErr}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.subdomainManage(subdomainId, subdomain.domain_id),
        }
      );
    }
  });

  // ────────────────────────────────────────────
  // Delete subdomain — confirmation
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^subdomain_delete_(\d+)$/);
    if (!match) return;

    const subdomainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    await bot.answerCallbackQuery(query.id);

    const subdomain = db.getSubdomain(subdomainId);
    if (!subdomain) return;

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id);
    if (!access.allowed) return;

    const text =
      `⚠️ <b>DELETE SUBDOMAIN</b>\n\n` +
      `You are about to delete:\n` +
      `🌐 <b>${subdomain.full_domain}</b>\n\n` +
      `This will PERMANENTLY remove:\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🗑️ All website files\n` +
      `🗑️ Nginx configuration\n` +
      `🗑️ SSL certificate\n` +
      `🗑️ DNS records\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ THIS ACTION CANNOT BE UNDONE!`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.confirmDelete('subdomain', subdomainId),
    });
  });

  // ────────────────────────────────────────────
  // Delete subdomain — confirmed
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^confirm_delete_subdomain_(\d+)$/);
    if (!match) return;

    const subdomainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const subdomain = db.getSubdomain(subdomainId);
    if (!subdomain) return;

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    await bot.editMessageText(
      `🗑️ Deleting ${subdomain.full_domain}...\n\nPlease wait...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    try {
      const steps = [];
      await vpsManager.deleteSubdomain(subdomainId, String(query.from.id), (step) => {
        steps.push(step);
      });

      let report = `✅ <b>SUBDOMAIN DELETED</b>\n\n`;
      report += `${subdomain.full_domain} has been completely removed.\n\n`;
      report += `Progress:\n`;
      report += steps.map(s => `[✓] ${s}`).join('\n');

      await bot.editMessageText(report, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Manage Domain', callback_data: `domain_manage_${subdomain.domain_id}` }],
            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }],
          ],
        },
      });
    } catch (err) {
      logger.error('Subdomain deletion failed', { subdomainId, error: err.message });
      await bot.editMessageText(
        `❌ Failed to delete subdomain: ${err.message}`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.backToMain(),
        }
      );
    }
  });
}

module.exports = { registerSubdomainHandlers };
