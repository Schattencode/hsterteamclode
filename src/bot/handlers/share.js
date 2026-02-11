const menus = require('../keyboards/menus');
const logger = require('../../utils/logger');

/**
 * Register domain sharing handlers.
 */
function registerShareHandlers(bot, db, auth, activityLogger) {

  // ────────────────────────────────────────────
  // Share domain menu — show shared users
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^domain_share_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Only the domain owner can share', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const sharedUsers = db.getDomainSharedUsers(domainId);

    let text = `👥 <b>Share: ${domain.domain}</b>\n\n`;

    if (sharedUsers.length === 0) {
      text += `This domain is not shared with anyone.\n\n`;
      text += `Share it with team members to give them access.`;
    } else {
      text += `Shared with ${sharedUsers.length} member(s):\n\n`;
      for (const su of sharedUsers) {
        const name = su.username ? `@${su.username}` : (su.first_name || su.user_telegram_id);
        const levelIcon = su.access_level === 'edit' ? '✏️ Edit' : '👁️ View';
        text += `• <b>${name}</b> — ${levelIcon}\n`;
      }
    }

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.domainShareMenu(domainId, sharedUsers),
    });
  });

  // ────────────────────────────────────────────
  // Add share — select team member
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^share_add_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const allUsers = db.getActiveUsers();
    const sharedUsers = db.getDomainSharedUsers(domainId);
    const sharedIds = new Set(sharedUsers.map(su => su.user_telegram_id));

    // Filter: active members not already shared, not the owner
    const available = allUsers.filter(u =>
      String(u.telegram_id) !== String(domain.created_by) &&
      !sharedIds.has(String(u.telegram_id))
    );

    if (available.length === 0) {
      return bot.editMessageText(
        `👥 <b>Share: ${domain.domain}</b>\n\n` +
        `No available team members to share with.\n\n` +
        `All team members already have access, or there are no other members.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Back', callback_data: `domain_share_${domainId}` }],
            ],
          },
        }
      );
    }

    let text = `👥 <b>Share ${domain.domain}</b>\n\nSelect a team member:\n`;

    const keyboard = [];
    for (const u of available) {
      const name = u.username ? `@${u.username}` : (u.first_name || u.telegram_id);
      const roleIcon = u.role === 'admin' ? '👑' : '👤';
      keyboard.push([
        { text: `${roleIcon} ${name}`, callback_data: `share_select_${domainId}_${u.telegram_id}` },
      ]);
    }
    keyboard.push([{ text: '⬅️ Back', callback_data: `domain_share_${domainId}` }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Select member — choose access level
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^share_select_(\d+)_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const targetId = match[2];
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const targetUser = db.getUserByTelegramId(targetId);
    const name = targetUser
      ? (targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || targetId))
      : targetId;

    const text =
      `👥 <b>Share ${domain.domain}</b>\n\n` +
      `Member: <b>${name}</b>\n\n` +
      `Select access level:\n\n` +
      `👁️ <b>View</b> — Can see domain info and subdomains\n` +
      `✏️ <b>Edit</b> — Can update files, manage SSL, add subdomains`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.shareAccessLevel(domainId, targetId),
    });
  });

  // ────────────────────────────────────────────
  // Set access level (also used for changing level)
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^share_level_(view|edit)_(\d+)_(\d+)$/);
    if (!match) return;

    const level = match[1];
    const domainId = parseInt(match[2], 10);
    const targetId = match[3];
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    db.shareDomain(domainId, targetId, level, query.from.id);

    activityLogger.log({
      telegramId: query.from.id,
      action: 'share_domain',
      resourceType: 'domain',
      resourceId: String(domainId),
      details: { targetId, level },
    });

    const targetUser = db.getUserByTelegramId(targetId);
    const name = targetUser
      ? (targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || targetId))
      : targetId;
    const levelIcon = level === 'edit' ? '✏️' : '👁️';

    // Notify the target user
    try {
      await bot.sendMessage(targetId,
        `🔗 <b>Domain Shared With You</b>\n\n` +
        `🌐 <b>${domain.domain}</b>\n` +
        `${levelIcon} Access: <b>${level}</b>\n\n` +
        `You can now see this domain in your domain list.`,
        { parse_mode: 'HTML' }
      );
    } catch {
      // User may not have started the bot
    }

    await bot.editMessageText(
      `✅ <b>${domain.domain}</b> shared with <b>${name}</b>\n\n` +
      `${levelIcon} Access level: ${level}`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Sharing Settings', callback_data: `domain_share_${domainId}` }],
            [{ text: '📋 Manage Domain', callback_data: `domain_manage_${domainId}` }],
          ],
        },
      }
    );
  });

  // ────────────────────────────────────────────
  // Manage shared user
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^share_manage_(\d+)_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const targetId = match[2];
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    const shared = db.getDomainAccess(domainId, targetId);
    if (!shared) {
      return bot.editMessageText('Share not found.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `domain_share_${domainId}` }]] },
      });
    }

    const targetUser = db.getUserByTelegramId(targetId);
    const name = targetUser
      ? (targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || targetId))
      : targetId;
    const levelIcon = shared.access_level === 'edit' ? '✏️ Edit' : '👁️ View';

    const text =
      `👥 <b>Shared Access</b>\n\n` +
      `🌐 Domain: <b>${domain.domain}</b>\n` +
      `👤 Member: <b>${name}</b>\n` +
      `🔑 Access: ${levelIcon}\n` +
      `📅 Shared: ${shared.created_at}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...menus.shareManageUser(domainId, targetId, shared.access_level),
    });
  });

  // ────────────────────────────────────────────
  // Revoke access
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^share_revoke_(\d+)_(\d+)$/);
    if (!match) return;

    const domainId = parseInt(match[1], 10);
    const targetId = match[2];
    const chatId = query.message.chat.id;

    const access = await auth.checkDomainOwnership(query, domainId);
    if (!access.allowed || access.accessLevel !== 'owner') {
      return bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    }
    await bot.answerCallbackQuery(query.id);

    const domain = db.getDomain(domainId);
    db.unshareDomain(domainId, targetId);

    activityLogger.log({
      telegramId: query.from.id,
      action: 'unshare_domain',
      resourceType: 'domain',
      resourceId: String(domainId),
      details: { targetId },
    });

    const targetUser = db.getUserByTelegramId(targetId);
    const name = targetUser
      ? (targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || targetId))
      : targetId;

    // Notify the target user
    try {
      await bot.sendMessage(targetId,
        `🔒 <b>Domain Access Revoked</b>\n\n` +
        `Your access to <b>${domain.domain}</b> has been removed.`,
        { parse_mode: 'HTML' }
      );
    } catch {
      // User may not have started the bot
    }

    await bot.editMessageText(
      `✅ Access revoked for <b>${name}</b> on <b>${domain.domain}</b>`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Sharing Settings', callback_data: `domain_share_${domainId}` }],
            [{ text: '📋 Manage Domain', callback_data: `domain_manage_${domainId}` }],
          ],
        },
      }
    );
  });
}

module.exports = { registerShareHandlers };
