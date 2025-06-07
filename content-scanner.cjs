const fs = require('fs').promises;
const path = require('path');

async function scanExistingContent() {
  const contentDir = './Content';
  const progressFile = './download-progress.json';
  const forceRescan = process.env.FORCE_RESCAN === 'true';
  
  console.log('🔍 Starting content scan...');
  console.log(`Force rescan: ${forceRescan}`);
  
  // Get existing progress if available and not forcing rescan
  let existingProgress = { processed: new Set(), failed: new Set(), totalFiles: 0 };
  if (!forceRescan) {
    try {
      const progressData = await fs.readFile(progressFile, 'utf8');
      const progress = JSON.parse(progressData);
      existingProgress.processed = new Set(progress.processed || []);
      existingProgress.failed = new Set(progress.failed || []);
      existingProgress.totalFiles = progress.totalFiles || 0;
      console.log(`📄 Loaded existing progress: ${existingProgress.processed.size} processed, ${existingProgress.failed.size} failed`);
    } catch (error) {
      console.log('📄 No existing progress file found or invalid, starting fresh scan');
    }
  }
  
  // Scan actual files in Content directory
  const existingFiles = new Set();
  try {
    const scanDirectory = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          // Store relative path from Content directory
          const relativePath = path.relative(contentDir, fullPath);
          existingFiles.add(relativePath);
        }
      }
    };
    
    await scanDirectory(contentDir);
    console.log(`📁 Found ${existingFiles.size} existing files in Content directory`);
  } catch (error) {
    console.log('📁 Content directory is empty or doesn\'t exist');
  }
  
  // Find all JSON metadata files that define what should be downloaded
  const metadataFiles = [];
  const findJsonFiles = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'Content' && !entry.name.startsWith('.')) {
          await findJsonFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'download-progress.json') {
          metadataFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }
  };
  
  await findJsonFiles('./');
  console.log(`📋 Found ${metadataFiles.length} metadata JSON files`);
  
  // Parse metadata files to get list of files that should exist
  const expectedFiles = new Map(); // filename -> metadata
  for (const metadataFile of metadataFiles) {
    try {
      const content = await fs.readFile(metadataFile, 'utf8');
      const metadata = JSON.parse(content);
      
      // Handle different JSON structures - adapt this based on your metadata format
      if (Array.isArray(metadata)) {
        // Array of file objects
        for (const item of metadata) {
          if (item.filename || item.name || item.file) {
            const filename = item.filename || item.name || item.file;
            expectedFiles.set(filename, { ...item, source: metadataFile });
          }
        }
      } else if (metadata.files && Array.isArray(metadata.files)) {
        // Object with files array
        for (const item of metadata.files) {
          if (item.filename || item.name || item.file) {
            const filename = item.filename || item.name || item.file;
            expectedFiles.set(filename, { ...item, source: metadataFile });
          }
        }
      } else if (typeof metadata === 'object') {
        // Object with file entries
        for (const [key, value] of Object.entries(metadata)) {
          if (typeof value === 'object' && (value.url || value.download_url)) {
            expectedFiles.set(key, { ...value, source: metadataFile });
          }
        }
      }
    } catch (error) {
      console.log(`⚠️ Error parsing ${metadataFile}: ${error.message}`);
    }
  }
  
  console.log(`📊 Expected ${expectedFiles.size} files based on metadata`);
  
  // Find missing files
  const missingFiles = [];
  const corruptedFiles = [];
  
  for (const [filename, metadata] of expectedFiles.entries()) {
    const isProcessed = existingProgress.processed.has(filename);
    const hasFailed = existingProgress.failed.has(filename);
    const fileExists = existingFiles.has(filename);
    
    if (!fileExists && !hasFailed) {
      // File doesn't exist and hasn't permanently failed
      missingFiles.push({ filename, metadata });
    } else if (fileExists) {
      // Check if file might be corrupted (size check)
      try {
        const filePath = path.join(contentDir, filename);
        const stats = await fs.stat(filePath);
        
        // Check for Google Drive error files (around 1.96KB)
        if (stats.size > 1950 && stats.size < 1970) {
          console.log(`⚠️ Potential error file detected: ${filename} (${stats.size} bytes)`);
          corruptedFiles.push({ filename, metadata, size: stats.size });
          missingFiles.push({ filename, metadata }); // Re-download
        }
        
        // Check for suspiciously small files (less than 1KB for non-text files)
        else if (stats.size < 1024 && !filename.match(/\.(txt|json|xml|css|js)$/i)) {
          console.log(`⚠️ Suspiciously small file: ${filename} (${stats.size} bytes)`);
          corruptedFiles.push({ filename, metadata, size: stats.size });
          missingFiles.push({ filename, metadata }); // Re-download
        }
      } catch (error) {
        console.log(`⚠️ Error checking file ${filename}: ${error.message}`);
        missingFiles.push({ filename, metadata }); // Re-download if can't check
      }
    }
  }
  
  // Generate download queue
  const downloadQueue = {
    missing: missingFiles,
    corrupted: corruptedFiles,
    total: missingFiles.length,
    existing: existingFiles.size,
    expected: expectedFiles.size,
    timestamp: new Date().toISOString()
  };
  
  // Save download queue
  await fs.writeFile('./download-queue.json', JSON.stringify(downloadQueue, null, 2));
  
  console.log(`✅ Scan complete:`);
  console.log(`   - Existing files: ${existingFiles.size}`);
  console.log(`   - Expected files: ${expectedFiles.size}`);
  console.log(`   - Missing files: ${missingFiles.length}`);
  console.log(`   - Corrupted files: ${corruptedFiles.length}`);
  
  return downloadQueue;
}

scanExistingContent().catch(console.error);
