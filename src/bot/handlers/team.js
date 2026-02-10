const menus = require('../keyboards/menus');
const Validator = require('../../utils/validator');
const logger = require('../../utils/logger');

/**
 * Register team management handlers.
 */
function registerTeamHandlers(bot, db, auth, activityLogger) {

  // ────────────────────────────────────────────
  // Team management submenu
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'admin_team') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    await bot.editMessageText(
      `👥 *Team Management*\n\nManage team members and their access.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...menus.adminTeam(),
      }
    );
  });

  // ────────────────────────────────────────────
  // Add team member — ask for Telegram ID
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'team_add') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    bot._userStates = bot._userStates || {};
    bot._userStates[query.from.id] = { step: 'team_enter_id' };

    await bot.editMessageText(
      `👥 *ADD TEAM MEMBER*\n\n` +
      `Please provide the user's Telegram User ID.\n\n` +
      `How to find User ID:\n` +
      `• Ask user to message @userinfobot\n` +
      `• Or forward their message to @userinfobot\n\n` +
      `Send the numeric User ID (e.g. 123456789):`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...menus.cancelButton(),
      }
    );
  });

  // ────────────────────────────────────────────
  // List team members
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (query.data !== 'team_list') return;

    const chatId = query.message.chat.id;
    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const users = db.getAllUsers();

    if (users.length === 0) {
      return bot.editMessageText(
        `👥 *Team Members*\n\nNo team members yet.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          ...menus.adminTeam(),
        }
      );
    }

    const admins = users.filter(u => u.role === 'admin');
    const members = users.filter(u => u.role === 'member');

    let text = `👥 *TEAM MEMBERS* (${users.length})\n\n`;

    if (admins.length > 0) {
      text += `━━━ 👑 ADMINS (${admins.length}) ━━━\n\n`;
      for (const u of admins) {
        const name = u.username ? `@${u.username}` : (u.first_name || 'Unknown');
        const domains = db.getUserDomainCount(u.telegram_id);
        const lastActive = u.last_active || 'Never';
        text += `👑 *${name}*\n`;
        text += `   🆔 ID: \`${u.telegram_id}\`\n`;
        text += `   📊 Domains: ${domains}\n`;
        text += `   ⏰ Last active: ${lastActive}\n\n`;
      }
    }

    if (members.length > 0) {
      text += `━━━ 👤 MEMBERS (${members.length}) ━━━\n\n`;
      for (const u of members) {
        const name = u.username ? `@${u.username}` : (u.first_name || 'Unknown');
        const domains = db.getUserDomainCount(u.telegram_id);
        const lastActive = u.last_active || 'Never';
        text += `👤 *${name}*\n`;
        text += `   🆔 ID: \`${u.telegram_id}\`\n`;
        text += `   📊 Domains: ${domains}\n`;
        text += `   ⏰ Last active: ${lastActive}\n\n`;
      }
    }

    const keyboard = [];

    // Add action buttons for non-self members
    for (const u of users) {
      if (String(u.telegram_id) === String(query.from.id)) continue; // Can't modify self
      const name = u.username ? `@${u.username}` : (u.first_name || u.telegram_id);
      keyboard.push([
        { text: `🔧 ${name}`, callback_data: `team_member_${u.telegram_id}` },
      ]);
    }

    keyboard.push([{ text: '➕ Add Member', callback_data: 'team_add' }]);
    keyboard.push([{ text: '⬅️ Back', callback_data: 'admin_panel' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ────────────────────────────────────────────
  // Manage individual team member
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^team_member_(\d+)$/);
    if (!match) return;

    const targetId = match[1];
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const user = db.getUserByTelegramId(targetId);
    if (!user) {
      return bot.editMessageText('User not found.', {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...menus.adminTeam(),
      });
    }

    const name = user.username ? `@${user.username}` : (user.first_name || 'Unknown');
    const domains = db.getUserDomainCount(user.telegram_id);
    const roleIcon = user.role === 'admin' ? '👑' : '👤';

    const text =
      `🔧 *Team Member: ${name}*\n\n` +
      `${roleIcon} Role: ${user.role}\n` +
      `🆔 ID: \`${user.telegram_id}\`\n` +
      `📊 Domains: ${domains}\n` +
      `📅 Joined: ${user.created_at}\n` +
      `⏰ Last active: ${user.last_active || 'Never'}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...menus.teamMemberActions(targetId, user.role),
    });
  });

  // ────────────────────────────────────────────
  // Promote to admin
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^team_promote_(\d+)$/);
    if (!match) return;

    const targetId = match[1];
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    db.updateUser(targetId, { role: 'admin' });

    activityLogger.log({
      telegramId: query.from.id,
      action: 'promote_user',
      resourceType: 'user',
      resourceId: targetId,
    });

    const user = db.getUserByTelegramId(targetId);
    const name = user.username ? `@${user.username}` : (user.first_name || targetId);

    // Notify the promoted user
    try {
      await bot.sendMessage(targetId,
        `👑 *Role Updated*\n\nYou have been promoted to *Admin* by the team administrator.\n\nYou now have full access to all bot features.`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // User may not have started the bot yet
    }

    await bot.editMessageText(
      `✅ ${name} has been promoted to *Admin*.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Team List', callback_data: 'team_list' }],
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
          ],
        },
      }
    );
  });

  // ────────────────────────────────────────────
  // Demote to member
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^team_demote_(\d+)$/);
    if (!match) return;

    const targetId = match[1];
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    // Prevent demoting self
    if (String(query.from.id) === targetId) {
      return bot.editMessageText(
        `❌ You cannot demote yourself.`,
        { chat_id: chatId, message_id: query.message.message_id, ...menus.adminTeam() }
      );
    }

    db.updateUser(targetId, { role: 'member' });

    activityLogger.log({
      telegramId: query.from.id,
      action: 'demote_user',
      resourceType: 'user',
      resourceId: targetId,
    });

    const user = db.getUserByTelegramId(targetId);
    const name = user.username ? `@${user.username}` : (user.first_name || targetId);

    try {
      await bot.sendMessage(targetId,
        `👤 *Role Updated*\n\nYour role has been changed to *Member*.`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // User may not have started the bot
    }

    await bot.editMessageText(
      `✅ ${name} has been demoted to *Member*.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Team List', callback_data: 'team_list' }],
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
          ],
        },
      }
    );
  });

  // ────────────────────────────────────────────
  // Remove team member
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^team_remove_(\d+)$/);
    if (!match) return;

    const targetId = match[1];
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    if (String(query.from.id) === targetId) {
      return bot.editMessageText(
        `❌ You cannot remove yourself.`,
        { chat_id: chatId, message_id: query.message.message_id, ...menus.adminTeam() }
      );
    }

    const user = db.getUserByTelegramId(targetId);
    if (!user) return;

    const name = user.username ? `@${user.username}` : (user.first_name || targetId);

    await bot.editMessageText(
      `⚠️ *Remove Team Member*\n\n` +
      `Remove *${name}* from the team?\n\n` +
      `They will lose access to the bot but their domains will remain.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚠️ Yes, Remove', callback_data: `team_confirm_remove_${targetId}` }],
            [{ text: '❌ Cancel', callback_data: 'team_list' }],
          ],
        },
      }
    );
  });

  // Confirm removal
  bot.on('callback_query', async (query) => {
    const match = query.data.match(/^team_confirm_remove_(\d+)$/);
    if (!match) return;

    const targetId = match[1];
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const user = db.getUserByTelegramId(targetId);
    const name = user ? (user.username ? `@${user.username}` : (user.first_name || targetId)) : targetId;

    db.deleteUser(targetId);

    activityLogger.log({
      telegramId: query.from.id,
      action: 'remove_user',
      resourceType: 'user',
      resourceId: targetId,
    });

    try {
      await bot.sendMessage(targetId,
        `🚫 *Access Revoked*\n\nYour access to the Hosting Management Bot has been removed.\n\nContact an administrator if you believe this is an error.`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // User may not have started the bot
    }

    await bot.editMessageText(
      `✅ ${name} has been removed from the team.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Team List', callback_data: 'team_list' }],
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
          ],
        },
      }
    );
  });

  // ────────────────────────────────────────────
  // Role assignment during team_add flow
  // ────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const matchMember = query.data.match(/^team_role_member_(\d+)$/);
    const matchAdmin = query.data.match(/^team_role_admin_(\d+)$/);
    const match = matchMember || matchAdmin;
    if (!match) return;

    const targetId = match[1];
    const role = matchMember ? 'member' : 'admin';
    const chatId = query.message.chat.id;

    const access = await auth.checkAdmin(query);
    if (!access.allowed) return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    await bot.answerCallbackQuery(query.id);

    const state = (bot._userStates || {})[query.from.id];

    // Check if user already exists
    const existing = db.getUserByTelegramId(targetId);
    if (existing) {
      delete bot._userStates[query.from.id];
      return bot.editMessageText(
        `❌ User with ID ${targetId} is already a team member.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...menus.adminTeam(),
        }
      );
    }

    // Create user
    const newUser = db.createUser({
      telegram_id: targetId,
      username: state?.pendingUsername || null,
      first_name: state?.pendingFirstName || null,
      last_name: null,
      role,
      created_by: String(query.from.id),
    });

    activityLogger.log({
      telegramId: query.from.id,
      action: 'add_team_member',
      resourceType: 'user',
      resourceId: targetId,
      details: { role },
    });

    delete bot._userStates[query.from.id];

    const roleIcon = role === 'admin' ? '👑' : '👤';

    // Notify new user
    try {
      await bot.sendMessage(targetId,
        `🎉 *Welcome to Hosting Management Bot!*\n\n` +
        `You've been granted access.\n\n` +
        `Your role: ${roleIcon} *${role.charAt(0).toUpperCase() + role.slice(1)}*\n\n` +
        `You can now:\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Add new domains\n` +
        `✅ Create subdomains\n` +
        `✅ Upload website files\n` +
        `✅ Manage your domains\n` +
        `✅ Obtain SSL certificates\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Type /start to get started!`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // User may not have started the bot
    }

    await bot.editMessageText(
      `✅ *TEAM MEMBER ADDED*\n\n` +
      `🆔 User ID: \`${targetId}\`\n` +
      `${roleIcon} Role: ${role}\n\n` +
      `The user has been notified (if they've started the bot).`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Another', callback_data: 'team_add' }],
            [{ text: '📋 View Team', callback_data: 'team_list' }],
            [{ text: '⬅️ Back', callback_data: 'admin_panel' }],
          ],
        },
      }
    );
  });
}

module.exports = { registerTeamHandlers };
