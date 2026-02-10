const logger = require('../../utils/logger');

/**
 * Middleware that logs bot interactions for audit purposes.
 */
class ActivityLogger {
  constructor(db) {
    this.db = db;
  }

  /**
   * Log a user action to the activity_logs table.
   */
  log({ telegramId, action, resourceType, resourceId, details, success, errorMessage }) {
    try {
      this.db.logActivity({
        user_telegram_id: String(telegramId),
        action,
        resource_type: resourceType || null,
        resource_id: resourceId || null,
        details: typeof details === 'object' ? JSON.stringify(details) : details,
        success: success !== false,
        error_message: errorMessage || null,
      });
    } catch (err) {
      logger.error('Failed to write activity log', { error: err.message });
    }
  }

  /**
   * Log a command invocation.
   */
  logCommand(msg, command) {
    this.log({
      telegramId: msg.from.id,
      action: `command:${command}`,
      details: { chat_id: msg.chat.id },
    });
  }

  /**
   * Log a callback query action.
   */
  logCallback(callbackQuery, action) {
    this.log({
      telegramId: callbackQuery.from.id,
      action: `callback:${action}`,
      details: { data: callbackQuery.data },
    });
  }
}

module.exports = ActivityLogger;
