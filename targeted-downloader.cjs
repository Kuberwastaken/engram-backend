const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const { createWriteStream, createReadStream } = require('fs');

class TargetedDownloader {
  constructor() {
    this.batchSizeGB = parseFloat(process.env.BATCH_SIZE_GB || '10');
    this.batchSizeBytes = this.batchSizeGB * 1024 * 1024 * 1024;
    this.currentBatchSize = 0;
    this.downloadedCount = 0;
    this.failedCount = 0;
    this.batchCount = 0;
    this.progress = {
      processed: new Set(),
      failed: new Set(),
      totalFiles: 0,
      downloadedSize: 0,
      lastUpdated: new Date().toISOString()
    };
  }
  
  async loadQueue() {
    try {
      const queueData = await fs.readFile('./download-queue.json', 'utf8');
      const queue = JSON.parse(queueData);
      console.log(`📋 Loaded download queue with ${queue.total} files`);
      return queue.missing || [];
    } catch (error) {
      console.error('❌ Failed to load download queue:', error.message);
      return [];
    }
  }
  
  async loadProgress() {
    try {
      const progressData = await fs.readFile('./download-progress.json', 'utf8');
      const savedProgress = JSON.parse(progressData);
      this.progress.processed = new Set(savedProgress.processed || []);
      this.progress.failed = new Set(savedProgress.failed || []);
      this.progress.totalFiles = savedProgress.totalFiles || 0;
      this.progress.downloadedSize = savedProgress.downloadedSize || 0;
      console.log(`📄 Loaded existing progress: ${this.progress.processed.size} processed, ${this.progress.failed.size} failed`);
    } catch (error) {
      console.log('📄 No existing progress file, starting fresh');
    }
  }
  
  async saveProgress() {
    this.progress.lastUpdated = new Date().toISOString();
    this.progress.processed = Array.from(this.progress.processed);
    this.progress.failed = Array.from(this.progress.failed);
    
    await fs.writeFile('./download-progress.json', JSON.stringify(this.progress, null, 2));
    
    // Convert back to Sets for continued operation
    this.progress.processed = new Set(this.progress.processed);
    this.progress.failed = new Set(this.progress.failed);
  }
  
  async downloadFile(fileInfo) {
    const { filename, metadata } = fileInfo;
    const url = metadata.url || metadata.download_url || metadata.link;
    
    if (!url) {
      console.log(`⚠️ No download URL found for ${filename}`);
      this.progress.failed.add(filename);
      this.failedCount++;
      return false;
    }
    
    const filePath = path.join('./Content', filename);
    const fileDir = path.dirname(filePath);
    
    try {
      // Ensure directory exists
      await fs.mkdir(fileDir, { recursive: true });
      
      console.log(`⬇️ Downloading: ${filename}`);
      
      // Download file
      const response = await this.fetchWithRetry(url);
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'unknown'}: ${response?.statusText || 'Unknown error'}`);
      }
      
      // Stream to file
      const fileStream = createWriteStream(filePath);
      await pipeline(response.body, fileStream);
      
      // Check file size
      const stats = await fs.stat(filePath);
      console.log(`✅ Downloaded: ${filename} (${this.formatBytes(stats.size)})`);
      
      // Check for Google Drive error files
      if (stats.size > 1950 && stats.size < 1970) {
        console.log(`⚠️ Potential Google Drive error file: ${filename}`);
        await fs.unlink(filePath); // Delete the error file
        throw new Error('Google Drive quota/error response detected');
      }
      
      this.progress.processed.add(filename);
      this.currentBatchSize += stats.size;
      this.progress.downloadedSize += stats.size;
      this.downloadedCount++;
      
      return true;
      
    } catch (error) {
      console.log(`❌ Failed to download ${filename}: ${error.message}`);
      
      // Clean up partial file
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        // File might not exist, ignore
      }
      
      this.progress.failed.add(filename);
      this.failedCount++;
      return false;
    }
  }
  
  async fetchWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ContentDownloader/1.0)'
          },
          timeout: 30000 // 30 second timeout
        });
        
        if (response.ok) {
          return response;
        }
        
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || '60';
          const waitTime = parseInt(retryAfter) * 1000;
          console.log(`⏳ Rate limited, waiting ${retryAfter}s before retry ${attempt}/${maxRetries}`);
          await this.sleep(waitTime);
          continue;
        }
        
        if (attempt === maxRetries) {
          return response; // Return last response for error handling
        }
        
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.log(`🔄 Retry ${attempt}/${maxRetries} for ${url}: ${error.message}`);
        await this.sleep(2000 * attempt); // Exponential backoff
      }
    }
  }
  
  async commitBatch() {
    if (this.currentBatchSize === 0) return;
    
    this.batchCount++;
    console.log(`💾 Committing batch ${this.batchCount} (${this.formatBytes(this.currentBatchSize)})`);
    
    await this.saveProgress();
    
    // Git operations
    const { execSync } = require('child_process');
    try {
      execSync('git add Content/ download-progress.json', { stdio: 'inherit' });
      
      const commitMsg = `📚 Batch ${this.batchCount}: Downloaded ${this.downloadedCount} files (${this.formatBytes(this.progress.downloadedSize)}) - ${new Date().toISOString()}`;
      execSync(`git commit -m "${commitMsg}"`, { stdio: 'inherit' });
      execSync('git push', { stdio: 'inherit' });
      
      console.log(`✅ Batch ${this.batchCount} committed and pushed`);
    } catch (error) {
      console.log(`⚠️ Git operations failed: ${error.message}`);
    }
    
    this.currentBatchSize = 0;
  }
  
  async run() {
    console.log('🚀 Starting targeted download process...');
    
    await this.loadProgress();
    const downloadQueue = await this.loadQueue();
    
    if (downloadQueue.length === 0) {
      console.log('✅ No files to download');
      return;
    }
    
    this.progress.totalFiles = downloadQueue.length;
    console.log(`📊 Processing ${downloadQueue.length} files...`);
    
    for (let i = 0; i < downloadQueue.length; i++) {
      const fileInfo = downloadQueue[i];
      const filename = fileInfo.filename;
      
      // Skip if already processed or failed
      if (this.progress.processed.has(filename)) {
        continue;
      }
      
      console.log(`\n[${i + 1}/${downloadQueue.length}] Processing: ${filename}`);
      
      await this.downloadFile(fileInfo);
      
      // Commit batch if size limit reached
      if (this.currentBatchSize >= this.batchSizeBytes) {
        await this.commitBatch();
      }
      
      // Small delay to avoid overwhelming servers
      await this.sleep(100);
    }
    
    // Final commit
    if (this.currentBatchSize > 0) {
      await this.commitBatch();
    }
    
    await this.saveProgress();
    
    console.log('\n✅ Download process completed');
    console.log(`📊 Final stats: ${this.downloadedCount} downloaded, ${this.failedCount} failed`);
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the downloader
const downloader = new TargetedDownloader();
downloader.run().catch(console.error);
