const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const unzipper = require('unzipper');
const logger = require('../utils/logger');

class FileManager {
  constructor(tempDir) {
    this.tempDir = tempDir || './uploads';
  }

  /**
   * Download a file from Telegram bot API to a local temp path.
   */
  async downloadTelegramFile(bot, fileId, filename) {
    const dir = this.tempDir;
    await fsp.mkdir(dir, { recursive: true });

    const destPath = path.join(dir, `${Date.now()}_${filename}`);

    // Get file download stream from Telegram
    const fileStream = bot.getFileStream(fileId);

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);

      fileStream.pipe(writeStream);

      writeStream.on('finish', () => {
        logger.info('File downloaded from Telegram', { filename, path: destPath });
        resolve(destPath);
      });

      writeStream.on('error', (err) => {
        reject(new Error(`Failed to download file: ${err.message}`));
      });

      fileStream.on('error', (err) => {
        reject(new Error(`Failed to get file stream: ${err.message}`));
      });
    });
  }

  /**
   * Extract a ZIP file to a temporary directory.
   * Returns the path to the extracted directory.
   */
  async extractZip(zipPath) {
    const extractDir = zipPath.replace(/\.zip$/i, '') + '_extracted';
    await fsp.mkdir(extractDir, { recursive: true });

    try {
      await new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: extractDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Check if ZIP contained a single root folder and flatten if so
      const items = await fsp.readdir(extractDir);
      if (items.length === 1) {
        const singleItem = path.join(extractDir, items[0]);
        const stat = await fsp.stat(singleItem);
        if (stat.isDirectory()) {
          // Move contents up one level
          const innerItems = await fsp.readdir(singleItem);
          for (const inner of innerItems) {
            await fsp.rename(
              path.join(singleItem, inner),
              path.join(extractDir, inner)
            );
          }
          await fsp.rmdir(singleItem);
        }
      }

      logger.info('ZIP extracted', { zipPath, extractDir });
      return extractDir;
    } catch (error) {
      throw new Error(`Failed to extract ZIP: ${error.message}`);
    }
  }

  /**
   * Count files recursively in a directory.
   */
  async countFiles(dir) {
    let count = 0;
    const items = await fsp.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        count += await this.countFiles(fullPath);
      } else {
        count++;
      }
    }
    return count;
  }

  /**
   * Get total size of a directory in bytes.
   */
  async getDirectorySize(dir) {
    let size = 0;
    const items = await fsp.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        size += await this.getDirectorySize(fullPath);
      } else {
        size += stat.size;
      }
    }
    return size;
  }

  /**
   * Remove a temporary directory and all its contents.
   */
  async cleanup(dirPath) {
    try {
      await fsp.rm(dirPath, { recursive: true, force: true });
      logger.info('Cleaned up temp directory', { path: dirPath });
    } catch (error) {
      logger.warn('Cleanup failed', { path: dirPath, error: error.message });
    }
  }

  /**
   * Remove a single file.
   */
  async removeFile(filePath) {
    try {
      await fsp.unlink(filePath);
    } catch (error) {
      logger.warn('File removal failed', { path: filePath, error: error.message });
    }
  }

  /**
   * Format bytes to human-readable string.
   */
  static formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}

module.exports = FileManager;
