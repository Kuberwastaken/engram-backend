import UnifiedContentDownloader from './unified-content-downloader.js';

console.log('🚀 Starting Unified Content Downloader...');

const downloader = new UnifiedContentDownloader({
    outputDir: './Content',           // Output directory for organized content
    concurrentDownloads: 10,          // Number of simultaneous downloads
    pauseDuration: 30 * 60 * 1000,    // 30 minutes pause when Google Drive errors detected
    retryAttempts: 3,                 // Number of retry attempts per file
    requestDelay: 500                 // Delay between starting downloads (ms)
});

await downloader.downloadAllContent();
