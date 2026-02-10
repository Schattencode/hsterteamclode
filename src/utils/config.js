const path = require('path');

require('dotenv').config();

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
  },
  database: {
    path: process.env.DATABASE_PATH || './data/hosting.db',
  },
  dns: {
    apiUrl: process.env.PDNS_API_URL || 'http://localhost:8081/api/v1',
    apiKey: process.env.PDNS_API_KEY || '',
    ns1: process.env.NS1_HOSTNAME || 'ns1.yourdomain.com',
    ns2: process.env.NS2_HOSTNAME || 'ns2.yourdomain.com',
  },
  upload: {
    maxSizeMB: parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 100,
    tempDir: process.env.TEMP_UPLOAD_DIR || './uploads',
  },
  ssl: {
    adminEmail: process.env.SSL_ADMIN_EMAIL || 'admin@yourdomain.com',
    staging: process.env.SSL_STAGING === 'true',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/bot.log',
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};

function validateConfig() {
  const required = [
    ['telegram.token', config.telegram.token],
    ['telegram.adminIds', config.telegram.adminIds.length > 0],
  ];

  const missing = required.filter(([, value]) => !value);

  if (missing.length > 0) {
    const names = missing.map(([name]) => name).join(', ');
    throw new Error(`Missing required configuration: ${names}. Check your .env file.`);
  }
}

module.exports = { config, validateConfig };
