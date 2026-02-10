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

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = {
      step: 'subdomain_enter_name',
      domainId,
      parentDomain: domain.domain,
    };

    await bot.editMessageText(
      `➕ *New Subdomain for ${domain.domain}*\n\n` +
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
        parse_mode: 'Markdown',
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
      `🔧 *SUBDOMAIN: ${subdomain.full_domain}*\n\n` +
      `📁 Path: \`${subdomain.site_path || 'N/A'}\`\n` +
      `🔒 SSL: ${sslIcon}\n` +
      `📊 Status: ${subdomain.status === 'active' ? '🟢 Online' : '🔴 ' + subdomain.status}\n` +
      `⏰ Created: ${subdomain.created_at}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
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

    const access = await auth.checkDomainOwnership(query, subdomain.domain_id);
    if (!access.allowed) return;

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = {
      step: 'subdomain_update_zip',
      subdomainId,
      fullDomain: subdomain.full_domain,
    };

    await bot.editMessageText(
      `🔄 *Update Site Files: ${subdomain.full_domain}*\n\n` +
      `Please send a new ZIP archive.\n\n` +
      `⚠️ This will REPLACE all existing files in:\n` +
      `\`${subdomain.site_path}\`\n\n` +
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
      `⚠️ *DELETE SUBDOMAIN*\n\n` +
      `You are about to delete:\n` +
      `🌐 *${subdomain.full_domain}*\n\n` +
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
      parse_mode: 'Markdown',
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

      let report = `✅ *SUBDOMAIN DELETED*\n\n`;
      report += `${subdomain.full_domain} has been completely removed.\n\n`;
      report += `Progress:\n`;
      report += steps.map(s => `[✓] ${s}`).join('\n');

      await bot.editMessageText(report, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
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
