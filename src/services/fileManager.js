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
   * Junk entries created by macOS and other OS artefacts.
   */
  static JUNK_NAMES = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

  /**
   * Remove OS junk (__MACOSX, .DS_Store, Thumbs.db) from a directory recursively.
   */
  async _removeJunk(dir) {
    const items = await fsp.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (FileManager.JUNK_NAMES.has(item)) {
        await fsp.rm(fullPath, { recursive: true, force: true });
        logger.info('Removed junk entry', { path: fullPath });
        continue;
      }
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        await this._removeJunk(fullPath);
      }
    }
  }

  /**
   * Find the nearest directory containing an index file (index.html/index.php/index.htm).
   * Searches up to maxDepth levels deep. Returns null if not found.
   */
  async _findIndexDir(dir, maxDepth = 3) {
    if (maxDepth < 0) return null;

    const items = await fsp.readdir(dir);
    const indexFiles = ['index.html', 'index.php', 'index.htm'];

    if (items.some(item => indexFiles.includes(item.toLowerCase()))) {
      return dir;
    }

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        const found = await this._findIndexDir(fullPath, maxDepth - 1);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Flatten: move all files from sourceDir into targetDir using a temp directory
   * to avoid name collisions (fixes H1).
   */
  async _flattenInto(sourceDir, targetDir) {
    const tmpDir = path.join(path.dirname(targetDir), `_flatten_tmp_${Date.now()}`);
    await fsp.mkdir(tmpDir, { recursive: true });

    // Move contents to temp dir first
    const items = await fsp.readdir(sourceDir);
    for (const item of items) {
      await fsp.rename(path.join(sourceDir, item), path.join(tmpDir, item));
    }

    // Remove the now-empty source (or any leftovers like hidden files)
    await fsp.rm(sourceDir, { recursive: true, force: true });

    // Move from temp dir to target
    const tmpItems = await fsp.readdir(tmpDir);
    for (const item of tmpItems) {
      await fsp.rename(path.join(tmpDir, item), path.join(targetDir, item));
    }

    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  /**
   * Extract a ZIP file to a temporary directory.
   * Handles macOS junk, wrapper folders, and nested structures.
   * Returns the path to the extracted directory with index file at root.
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

      // Step 1: Remove OS junk (__MACOSX, .DS_Store, etc.)
      await this._removeJunk(extractDir);

      // Step 2: Flatten until index file is at root (max 3 levels)
      let indexDir = await this._findIndexDir(extractDir, 0);
      let flattened = 0;
      const maxFlatten = 3;

      while (!indexDir && flattened < maxFlatten) {
        const items = await fsp.readdir(extractDir);
        // Only flatten if there's a single directory remaining
        if (items.length === 1) {
          const singleItem = path.join(extractDir, items[0]);
          const stat = await fsp.stat(singleItem);
          if (stat.isDirectory()) {
            await this._flattenInto(singleItem, extractDir);
            flattened++;
            indexDir = await this._findIndexDir(extractDir, 0);
            continue;
          }
        }
        break;
      }

      // Step 3: If index still not at root, search deeper and flatten to it
      if (!indexDir) {
        indexDir = await this._findIndexDir(extractDir, maxFlatten);
        if (indexDir && indexDir !== extractDir) {
          await this._flattenInto(indexDir, extractDir);
          // Clean up empty parent dirs left behind
          await this._removeEmptyDirs(extractDir);
        }
      }

      logger.info('ZIP extracted', { zipPath, extractDir, flattened });
      return extractDir;
    } catch (error) {
      throw new Error(`Failed to extract ZIP: ${error.message}`);
    }
  }

  /**
   * Remove empty directories recursively (bottom-up cleanup after flatten).
   */
  async _removeEmptyDirs(dir) {
    const items = await fsp.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        await this._removeEmptyDirs(fullPath);
        const remaining = await fsp.readdir(fullPath);
        if (remaining.length === 0) {
          await fsp.rm(fullPath, { recursive: true, force: true });
        }
      }
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
