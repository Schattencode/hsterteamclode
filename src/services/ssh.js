const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class SSHManager {
  constructor(vpsConfig) {
    this.vpsConfig = vpsConfig;
    this.client = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.client) return this.client;

    return new Promise((resolve, reject) => {
      this.client = new Client();

      const keyPath = this.vpsConfig.ssh_key_path;
      let privateKey;

      try {
        privateKey = fs.readFileSync(keyPath);
      } catch (err) {
        return reject(new Error(`Cannot read SSH key at ${keyPath}: ${err.message}`));
      }

      const connectConfig = {
        host: this.vpsConfig.ip,
        port: this.vpsConfig.ssh_port || 22,
        username: this.vpsConfig.ssh_user || 'root',
        privateKey,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
      };

      this.client.on('ready', () => {
        this.connected = true;
        logger.info('SSH connected', { host: connectConfig.host });
        resolve(this.client);
      });

      this.client.on('error', (err) => {
        this.connected = false;
        logger.error('SSH connection error', { host: connectConfig.host, error: err.message });
        reject(err);
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      this.client.connect(connectConfig);
    });
  }

  async exec(command, timeout = 120000) {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
      }, timeout);

      this.client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        stream.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0 && stderr) {
            reject(new Error(`Command failed (exit code ${code}): ${stderr.trim()}`));
          } else {
            resolve(stdout.trim());
          }
        });
      });
    });
  }

  async uploadFile(localPath, remotePath) {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) return reject(new Error(`Failed to upload ${localPath} -> ${remotePath}: ${err.message}`));
          resolve();
        });
      });
    });
  }

  async uploadDirectory(localDir, remoteDir) {
    await this.exec(`mkdir -p ${remoteDir}`);

    const items = fs.readdirSync(localDir);

    for (const item of items) {
      const localPath = path.join(localDir, item);
      const remotePath = `${remoteDir}/${item}`;
      const stat = fs.statSync(localPath);

      if (stat.isDirectory()) {
        await this.uploadDirectory(localPath, remotePath);
      } else {
        await this.uploadFile(localPath, remotePath);
      }
    }
  }

  async testConnection() {
    try {
      await this.connect();
      const result = await this.exec('echo "SSH_OK" && hostname');
      return {
        success: true,
        hostname: result.split('\n').pop(),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }
}

module.exports = SSHManager;
