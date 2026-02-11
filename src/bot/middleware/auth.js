const logger = require('../../utils/logger');

class AuthMiddleware {
  constructor(db, adminIds) {
    this.db = db;
    this.adminIds = adminIds.map(String);
  }

  /**
   * Check if a Telegram user has access to the bot.
   * Auto-creates admin users on first use if they are in TELEGRAM_ADMIN_IDS.
   */
  async checkAccess(msg) {
    const telegramId = String(msg.from.id);

    // Auto-register configured admins
    if (this.adminIds.includes(telegramId)) {
      let user = this.db.getUserByTelegramId(telegramId);
      if (!user) {
        user = this.db.createUser({
          telegram_id: telegramId,
          username: msg.from.username || null,
          first_name: msg.from.first_name || null,
          last_name: msg.from.last_name || null,
          role: 'admin',
          created_by: 'system',
        });
        logger.info('Auto-registered admin', { telegramId });
      }
    }

    const user = this.db.getUserByTelegramId(telegramId);

    if (!user) {
      return {
        allowed: false,
        reason: '🚫 Access Denied\n\nYou are not authorized to use this bot.\n\nPlease contact an administrator to request access.',
      };
    }

    if (user.status !== 'active') {
      return {
        allowed: false,
        reason: '🚫 Account Inactive\n\nYour account has been deactivated.\n\nPlease contact an administrator.',
      };
    }

    // Update last active timestamp
    this.db.updateUser(telegramId, {
      last_active: new Date().toISOString(),
      username: msg.from.username || user.username,
      first_name: msg.from.first_name || user.first_name,
    });

    return { allowed: true, user };
  }

  /**
   * Check if user is an admin.
   */
  async checkAdmin(msg) {
    const access = await this.checkAccess(msg);
    if (!access.allowed) return access;

    if (access.user.role !== 'admin') {
      return {
        allowed: false,
        reason: '👑 Admin Access Required\n\nThis action requires administrator privileges.',
      };
    }

    return access;
  }

  /**
   * Check if user can manage a specific domain (owner, admin, or shared access).
   * Returns access object with `accessLevel` ('owner'|'edit'|'view') for shared domains.
   */
  async checkDomainOwnership(msg, domainId, requiredLevel = 'view') {
    const access = await this.checkAccess(msg);
    if (!access.allowed) return access;

    if (access.user.role === 'admin') {
      return { ...access, accessLevel: 'owner' };
    }

    const domain = this.db.getDomain(domainId);
    if (!domain) {
      return { allowed: false, reason: 'Domain not found.' };
    }

    // Owner has full access
    if (domain.created_by === String(msg.from.id)) {
      return { ...access, accessLevel: 'owner' };
    }

    // Check shared access
    const shared = this.db.getDomainAccess(domainId, String(msg.from.id));
    if (shared) {
      // Check if the required level is met
      if (requiredLevel === 'edit' && shared.access_level === 'view') {
        return {
          allowed: false,
          reason: '🚫 Access Denied\n\nYou have view-only access to this domain.',
        };
      }
      return { ...access, accessLevel: shared.access_level };
    }

    return {
      allowed: false,
      reason: '🚫 Access Denied\n\nYou can only manage domains you created or that have been shared with you.',
    };
  }
}

module.exports = AuthMiddleware;
