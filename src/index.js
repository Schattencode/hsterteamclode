const { config, validateConfig } = require('./utils/config');
const logger = require('./utils/logger');
const DB = require('./database/db');
const { createBot } = require('./bot/bot');

async function main() {
  logger.info('Starting Hosting Management Bot...');

  // Validate configuration
  try {
    validateConfig();
  } catch (err) {
    logger.error('Configuration error', { error: err.message });
    console.error(`\n❌ ${err.message}\n`);
    console.error('Copy .env.example to .env and configure your settings.');
    process.exit(1);
  }

  // Initialize database
  const db = new DB(config.database.path);
  try {
    db.initialize();
    logger.info('Database ready');
  } catch (err) {
    logger.error('Database initialization failed', { error: err.message });
    console.error(`\n❌ Database error: ${err.message}\n`);
    process.exit(1);
  }

  // Create and start bot
  let bot;
  try {
    bot = createBot(db, config);
    logger.info('Bot started successfully');
    console.log('✅ Hosting Management Bot is running!');
    console.log(`   Admin IDs: ${config.telegram.adminIds.join(', ')}`);
    console.log(`   DNS NS1: ${config.dns.ns1}`);
    console.log(`   DNS NS2: ${config.dns.ns2}`);
    console.log(`   Database: ${config.database.path}`);
  } catch (err) {
    logger.error('Bot startup failed', { error: err.message });
    console.error(`\n❌ Bot startup failed: ${err.message}\n`);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down...`);
    console.log(`\n${signal} received. Shutting down...`);

    if (bot) {
      bot.stopPolling();
    }

    db.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    console.error('Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    console.error('Unhandled rejection:', reason);
  });
}

main();
