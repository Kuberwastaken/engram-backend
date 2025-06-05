import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class UnifiedContentDownloader {
    constructor(options = {}) {
        this.contentDir = path.resolve(options.outputDir || './Content');
        this.concurrentDownloads = options.concurrentDownloads || 10;
        this.pauseDuration = options.pauseDuration || 30 * 60 * 1000; // 30 minutes
        this.retryAttempts = options.retryAttempts || 3;
        this.requestDelay = options.requestDelay || 500; // 500ms between requests
        
        // Load all JSON data
        this.dataSources = {
            dotnotes: null,
            fifteenFourteen: null,
            studyX: null,
            syllabus: null,
            videos: null
        };
        
        // Statistics tracking
        this.stats = {
            totalFiles: 0,
            downloadedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            pausedForErrors: 0,
            startTime: new Date().toISOString(),
            downloadedSize: 0,
            errors: []
        };
        
        // Download management
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.isPaused = false;
        this.googleDriveErrorSize = 1960; // 1.96KB in bytes - Google Drive error response
        this.errorCount = 0;
        this.maxErrorsBeforePause = 5;
        
        // Progress tracking
        this.progressFile = './download-progress.json';
        this.completedFiles = new Set();
        
        // Initialize axios
        this.axios = axios.create({
            timeout: 300000, // 5 minutes
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });
    }

    async loadDataSources() {
        console.log('📚 Loading all data sources...');
        
        try {
            // Load Dotnotes
            console.log('  📖 Loading Dotnotes.json...');
            this.dataSources.dotnotes = JSON.parse(
                fs.readFileSync('./Mappings/Dotnotes.json', 'utf8')
            );
            
            // Load FifteenFourteen
            console.log('  📖 Loading FifteenFourteen.json...');
            this.dataSources.fifteenFourteen = JSON.parse(
                fs.readFileSync('./Mappings/FifteenFourteen.json', 'utf8')
            );
            
            // Load StudyX
            console.log('  📖 Loading StudyX.json...');
            this.dataSources.studyX = JSON.parse(
                fs.readFileSync('./Mappings/StudyX.json', 'utf8')
            );
            
            // Load Syllabus
            console.log('  📖 Loading syllabus.json...');
            this.dataSources.syllabus = JSON.parse(
                fs.readFileSync('./Mappings/syllabus.json', 'utf8')
            );
            
            // Load Videos
            console.log('  📖 Loading videos.json...');
            this.dataSources.videos = JSON.parse(
                fs.readFileSync('./Mappings/videos.json', 'utf8')
            );
            
            console.log('✅ All data sources loaded successfully!');
            return true;
        } catch (error) {
            console.error('❌ Failed to load data sources:', error.message);
            return false;
        }
    }

    loadProgress() {
        if (fs.existsSync(this.progressFile)) {
            try {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                this.completedFiles = new Set(progress.completed || []);
                console.log(`🔄 Loaded progress: ${this.completedFiles.size} files already completed`);
                return progress;
            } catch (error) {
                console.log('⚠️ Could not load previous progress, starting fresh');
            }
        }
        return { completed: [], stats: null };
    }

    saveProgress() {
        const progress = {
            completed: Array.from(this.completedFiles),
            stats: this.stats,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
    }

    sanitizeFileName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/[^\w\-_\.]/g, '_')
            .substring(0, 200)
            .trim('_');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
        return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }

    async downloadFile(downloadUrl, filePath, fileName, source, retryCount = 0) {
        try {
            // Create directory if it doesn't exist
            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            console.log(`📥 Downloading: ${fileName} [${source}]`);

            const response = await this.axios.get(downloadUrl, {
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve) => {
                writer.on('finish', async () => {
                    try {
                        const stats = fs.statSync(filePath);
                        
                        // Check if file is Google Drive error (1.96KB exactly)
                        if (stats.size === this.googleDriveErrorSize) {
                            console.log(`⚠️ Google Drive error detected for ${fileName} (${stats.size} bytes)`);
                            fs.unlinkSync(filePath); // Remove the error file
                            this.errorCount++;
                            
                            if (this.errorCount >= this.maxErrorsBeforePause) {
                                console.log(`🛑 Too many Google Drive errors (${this.errorCount}). Pausing for ${this.pauseDuration / 60000} minutes...`);
                                this.stats.pausedForErrors++;
                                await this.pauseDownloads();
                                this.errorCount = 0; // Reset error count after pause
                            }
                            
                            resolve({ success: false, error: 'Google Drive rate limit', size: stats.size });
                            return;
                        }

                        // File downloaded successfully
                        this.stats.downloadedFiles++;
                        this.stats.downloadedSize += stats.size;
                        this.completedFiles.add(`${source}_${fileName}`);
                        
                        console.log(`✅ ${fileName} (${this.formatFileSize(stats.size)}) [${source}]`);
                        resolve({ success: true, size: stats.size });
                        
                    } catch (error) {
                        console.log(`❌ Error finalizing ${fileName}: ${error.message}`);
                        this.stats.errorFiles++;
                        resolve({ success: false, error: error.message });
                    }
                });

                writer.on('error', (error) => {
                    console.log(`❌ Write error ${fileName}: ${error.message}`);
                    this.stats.errorFiles++;
                    this.stats.errors.push(`${fileName}: ${error.message}`);
                    resolve({ success: false, error: error.message });
                });
            });

        } catch (error) {
            if (retryCount < this.retryAttempts) {
                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10s
                console.log(`🔄 Retrying ${fileName} in ${delay/1000}s (${retryCount + 1}/${this.retryAttempts})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.downloadFile(downloadUrl, filePath, fileName, source, retryCount + 1);
            }

            console.log(`❌ Failed ${fileName} [${source}]: ${error.message}`);
            this.stats.errorFiles++;
            this.stats.errors.push(`${fileName}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async pauseDownloads() {
        this.isPaused = true;
        console.log(`⏸️ Pausing downloads for ${this.pauseDuration / 60000} minutes...`);
        
        // Save progress before pausing
        this.saveProgress();
        
        await new Promise(resolve => setTimeout(resolve, this.pauseDuration));
        
        this.isPaused = false;
        console.log('▶️ Resuming downloads...');
    }

    async processDownloadQueue() {
        console.log(`🚀 Starting downloads with ${this.concurrentDownloads} concurrent connections...`);
        console.log(`📊 Queue size: ${this.downloadQueue.length} files`);
        
        const downloadPromises = [];
        let queueIndex = 0;
        let batchCount = 0;
        
        while (queueIndex < this.downloadQueue.length || downloadPromises.length > 0) {
            // Wait if paused
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Fill up to max concurrent downloads
            while (downloadPromises.length < this.concurrentDownloads && queueIndex < this.downloadQueue.length) {
                const downloadTask = this.downloadQueue[queueIndex++];
                this.activeDownloads++;
                
                const promise = this.downloadFile(
                    downloadTask.downloadUrl,
                    downloadTask.filePath,
                    downloadTask.fileName,
                    downloadTask.source
                ).then(result => {
                    this.activeDownloads--;
                    return { ...result, task: downloadTask };
                });
                
                downloadPromises.push(promise);
                
                // Small delay between starting downloads
                await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            }
            
            // Wait for at least one download to complete
            if (downloadPromises.length > 0) {
                const completed = await Promise.race(downloadPromises);
                const completedIndex = downloadPromises.findIndex(p => p === completed);
                downloadPromises.splice(completedIndex, 1);
                
                batchCount++;
                
                // Print progress every 10 files
                if (batchCount % 10 === 0) {
                    this.printProgress();
                    this.saveProgress();
                }
            }
        }
        
        // Final progress and save
        this.printProgress();
        this.saveProgress();
    }

    printProgress() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles + this.stats.errorFiles;
        const percent = this.stats.totalFiles > 0 ? ((total / this.stats.totalFiles) * 100).toFixed(1) : '0.0';
        
        console.log(`📊 Progress: ${total}/${this.stats.totalFiles} (${percent}%) | ✅${this.stats.downloadedFiles} ⏭️${this.stats.skippedFiles} ❌${this.stats.errorFiles} | 💾${this.formatFileSize(this.stats.downloadedSize)} | ⏸️${this.stats.pausedForErrors} pauses`);
    }    extractFilesFromDotnotes() {
        console.log('🔍 Extracting files from Dotnotes...');
        const files = [];
        
        if (!this.dataSources.dotnotes?.branches) return files;
        
        for (const [branchName, branchData] of Object.entries(this.dataSources.dotnotes.branches)) {
            for (const [semesterName, semesterData] of Object.entries(branchData)) {
                for (const [subjectCode, subjectData] of Object.entries(semesterData)) {
                    // Extract from ALL categories found in deep analysis
                    const categories = [
                        'notes', 'pyqs', 'lab', 'akash', 'assignment', 
                        'books', 'syllabus', 'videos', 'viva'
                    ];
                    
                    for (const category of categories) {
                        if (subjectData[category] && Array.isArray(subjectData[category])) {
                            for (const file of subjectData[category]) {
                                if (file.downloadUrl && file.name) {
                                    let targetFolder, prefix;
                                    
                                    switch (category) {
                                        case 'notes':
                                            targetFolder = 'Notes';
                                            prefix = 'DN_';
                                            break;
                                        case 'pyqs':
                                            targetFolder = 'PYQs';
                                            prefix = 'DN_';
                                            break;
                                        case 'lab':
                                            targetFolder = 'Lab';
                                            prefix = '';
                                            break;
                                        case 'akash':
                                            targetFolder = 'Akash';
                                            prefix = '';
                                            break;
                                        case 'assignment':
                                            targetFolder = 'Assignment';
                                            prefix = 'DN_';
                                            break;
                                        case 'books':
                                            targetFolder = 'Books';
                                            prefix = '';
                                            break;
                                        case 'syllabus':
                                            targetFolder = 'Syllabus';
                                            prefix = 'DN_';
                                            break;
                                        case 'videos':
                                            targetFolder = 'Videos';
                                            prefix = 'DN_';
                                            break;
                                        case 'viva':
                                            targetFolder = 'Practicals';
                                            prefix = '';
                                            break;
                                        default:
                                            targetFolder = 'Misc';
                                            prefix = 'DN_';
                                    }
                                    
                                    files.push({
                                        downloadUrl: file.downloadUrl,
                                        fileName: prefix + this.sanitizeFileName(file.name),
                                        originalName: file.name,
                                        subjectCode,
                                        targetFolder,
                                        source: 'Dotnotes',
                                        branch: branchName,
                                        semester: semesterName,
                                        category: category
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Extracted ${files.length} files from Dotnotes`);
        return files;
    }

    extractFilesFromFifteenFourteen() {
        console.log('🔍 Extracting files from FifteenFourteen...');
        const files = [];
        
        if (!this.dataSources.fifteenFourteen?.branches?.COMMON) return files;
        
        for (const [semesterName, semesterData] of Object.entries(this.dataSources.fifteenFourteen.branches.COMMON)) {
            for (const [subjectCode, subjectData] of Object.entries(semesterData)) {
                // Extract notes
                if (subjectData.notes && Array.isArray(subjectData.notes)) {
                    for (const file of subjectData.notes) {
                        if (file.downloadUrl && file.name) {
                            files.push({
                                downloadUrl: file.downloadUrl,
                                fileName: 'FFT_' + this.sanitizeFileName(file.name),
                                originalName: file.name,
                                subjectCode,
                                targetFolder: 'Notes',
                                source: 'FifteenFourteen',
                                branch: 'COMMON',
                                semester: semesterName
                            });
                        }
                    }
                }
                
                // Extract PYQs if they exist
                if (subjectData.pyqs && Array.isArray(subjectData.pyqs)) {
                    for (const file of subjectData.pyqs) {
                        if (file.downloadUrl && file.name) {
                            files.push({
                                downloadUrl: file.downloadUrl,
                                fileName: 'FFT_' + this.sanitizeFileName(file.name),
                                originalName: file.name,
                                subjectCode,
                                targetFolder: 'PYQs',
                                source: 'FifteenFourteen',
                                branch: 'COMMON',
                                semester: semesterName
                            });
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Extracted ${files.length} files from FifteenFourteen`);
        return files;
    }    extractFilesFromStudyX() {
        console.log('🔍 Extracting files from StudyX...');
        const files = [];
        
        if (!this.dataSources.studyX?.materials) return files;
        
        // Helper function to extract files from materials
        const extractMaterialFiles = (subjectData, subjectCode, branchName, semesterName) => {
            if (!subjectData.materials) return;
            
            // Extract notes
            if (subjectData.materials.notes && Array.isArray(subjectData.materials.notes)) {
                for (const file of subjectData.materials.notes) {
                    const downloadUrl = file.links?.download || file.downloadLink;
                    if (downloadUrl && file.name) {
                        files.push({
                            downloadUrl,
                            fileName: 'SX_' + this.sanitizeFileName(file.name),
                            originalName: file.name,
                            subjectCode,
                            targetFolder: 'Notes',
                            source: 'StudyX',
                            branch: branchName,
                            semester: semesterName
                        });
                    }
                }
            }
            
            // Extract books (no prefix for StudyX books)
            if (subjectData.materials.books && Array.isArray(subjectData.materials.books)) {
                for (const file of subjectData.materials.books) {
                    const downloadUrl = file.links?.download || file.downloadLink;
                    if (downloadUrl && file.name) {
                        files.push({
                            downloadUrl,
                            fileName: this.sanitizeFileName(file.name),
                            originalName: file.name,
                            subjectCode,
                            targetFolder: 'Books',
                            source: 'StudyX',
                            branch: branchName,
                            semester: semesterName
                        });
                    }
                }
            }
            
            // Extract PYQs (check both pyqs and pyq, and questionPapers)
            const pyqSources = ['pyqs', 'pyq', 'questionPapers'];
            for (const pyqKey of pyqSources) {
                if (subjectData.materials[pyqKey] && Array.isArray(subjectData.materials[pyqKey])) {
                    for (const file of subjectData.materials[pyqKey]) {
                        const downloadUrl = file.links?.download || file.downloadLink;
                        if (downloadUrl && file.name) {
                            files.push({
                                downloadUrl,
                                fileName: 'SX_' + this.sanitizeFileName(file.name),
                                originalName: file.name,
                                subjectCode,
                                targetFolder: 'PYQs',
                                source: 'StudyX',
                                branch: branchName,
                                semester: semesterName
                            });
                        }
                    }
                }
            }
              // Extract Akash materials (no prefix)
            if (subjectData.materials.akash && Array.isArray(subjectData.materials.akash)) {
                for (const file of subjectData.materials.akash) {
                    const downloadUrl = file.links?.download || file.downloadLink;
                    if (downloadUrl && file.name) {
                        files.push({
                            downloadUrl,
                            fileName: this.sanitizeFileName(file.name),
                            originalName: file.name,
                            subjectCode,
                            targetFolder: 'Akash',
                            source: 'StudyX',
                            branch: branchName,
                            semester: semesterName
                        });
                    }
                }
            }

            // Extract lab materials (no prefix)
            if (subjectData.materials.lab && Array.isArray(subjectData.materials.lab)) {
                for (const file of subjectData.materials.lab) {
                    const downloadUrl = file.links?.download || file.downloadLink;
                    if (downloadUrl && file.name) {
                        files.push({
                            downloadUrl,
                            fileName: this.sanitizeFileName(file.name),
                            originalName: file.name,
                            subjectCode,
                            targetFolder: 'Lab',
                            source: 'StudyX',
                            branch: branchName,
                            semester: semesterName
                        });
                    }
                }
            }

            // Extract assignment materials
            const assignmentSources = ['assignment', 'assignments'];
            for (const assignmentKey of assignmentSources) {
                if (subjectData.materials[assignmentKey] && Array.isArray(subjectData.materials[assignmentKey])) {
                    for (const file of subjectData.materials[assignmentKey]) {
                        const downloadUrl = file.links?.download || file.downloadLink;
                        if (downloadUrl && file.name) {
                            files.push({
                                downloadUrl,
                                fileName: 'SX_' + this.sanitizeFileName(file.name),
                                originalName: file.name,
                                subjectCode,
                                targetFolder: 'Assignment',
                                source: 'StudyX',
                                branch: branchName,
                                semester: semesterName
                            });
                        }
                    }
                }
            }            // Extract viva/practical materials (including practicalfile)
            const practicalSources = ['viva', 'practicals', 'practical', 'practicalfile'];
            for (const practicalKey of practicalSources) {
                if (subjectData.materials[practicalKey] && Array.isArray(subjectData.materials[practicalKey])) {
                    for (const file of subjectData.materials[practicalKey]) {
                        const downloadUrl = file.links?.download || file.downloadLink;
                        if (downloadUrl && file.name) {
                            files.push({
                                downloadUrl,
                                fileName: this.sanitizeFileName(file.name),
                                originalName: file.name,
                                subjectCode,
                                targetFolder: 'Practicals',
                                source: 'StudyX',
                                branch: branchName,
                                semester: semesterName
                            });
                        }
                    }
                }
            }
        };
        
        // Process common materials
        if (this.dataSources.studyX.materials.common) {
            for (const [semesterName, semesterData] of Object.entries(this.dataSources.studyX.materials.common)) {
                if (semesterData.subjects) {
                    for (const [subjectCode, subjectData] of Object.entries(semesterData.subjects)) {
                        extractMaterialFiles(subjectData, subjectCode, 'COMMON', semesterName);
                    }
                }
            }
        }
        
        // Process branch-specific materials
        if (this.dataSources.studyX.materials.branches) {
            for (const [branchName, branchData] of Object.entries(this.dataSources.studyX.materials.branches)) {
                if (branchData.semesters) {
                    for (const [semesterName, semesterData] of Object.entries(branchData.semesters)) {
                        if (semesterData.subjects) {
                            for (const [subjectCode, subjectData] of Object.entries(semesterData.subjects)) {
                                extractMaterialFiles(subjectData, subjectCode, branchName, semesterName);
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Extracted ${files.length} files from StudyX`);
        return files;
    }

    extractSyllabusData() {
        console.log('🔍 Extracting syllabus data...');
        const syllabusFiles = [];
        
        if (!this.dataSources.syllabus?.syllabus) return syllabusFiles;
        
        for (const [branchName, branchData] of Object.entries(this.dataSources.syllabus.syllabus)) {
            for (const [semesterName, semesterData] of Object.entries(branchData)) {
                for (const [subjectCode, subjectData] of Object.entries(semesterData)) {
                    if (subjectData.content) {
                        syllabusFiles.push({
                            subjectCode,
                            content: subjectData.content,
                            branch: branchName,
                            semester: semesterName,
                            source: 'Syllabus'
                        });
                    }
                }
            }
        }
        
        console.log(`✅ Extracted ${syllabusFiles.length} syllabus entries`);
        return syllabusFiles;
    }

    extractVideoData() {
        console.log('🔍 Extracting video data...');
        const videoFiles = [];
        
        if (!this.dataSources.videos?.videos) return videoFiles;
        
        for (const [branchName, branchData] of Object.entries(this.dataSources.videos.videos)) {
            for (const [semesterName, semesterData] of Object.entries(branchData)) {
                for (const [subjectCode, subjectData] of Object.entries(semesterData)) {
                    if (subjectData.content && Array.isArray(subjectData.content)) {
                        videoFiles.push({
                            subjectCode,
                            videos: subjectData.content,
                            branch: branchName,
                            semester: semesterName,
                            source: 'Videos'
                        });
                    }
                }
            }
        }
        
        console.log(`✅ Extracted ${videoFiles.length} video collections`);
        return videoFiles;
    }

    createSyllabusFiles(syllabusData) {
        console.log('📝 Creating syllabus JSON files...');
        
        for (const syllabus of syllabusData) {
            const subjectDir = path.join(this.contentDir, syllabus.subjectCode);
            const syllabusDir = path.join(subjectDir, 'Syllabus');
            const syllabusFile = path.join(syllabusDir, 'syllabus.json');
            
            // Create directory
            fs.mkdirSync(syllabusDir, { recursive: true });
            
            // Write syllabus JSON
            fs.writeFileSync(syllabusFile, JSON.stringify(syllabus.content, null, 2));
            
            console.log(`✅ Created syllabus for ${syllabus.subjectCode}`);
        }
    }

    createVideoFiles(videoData) {
        console.log('🎥 Creating video JSON files...');
        
        for (const videoCollection of videoData) {
            const subjectDir = path.join(this.contentDir, videoCollection.subjectCode);
            const videosDir = path.join(subjectDir, 'Videos');
            const videosFile = path.join(videosDir, 'videos.json');
            
            // Create directory
            fs.mkdirSync(videosDir, { recursive: true });
            
            // Write videos JSON
            fs.writeFileSync(videosFile, JSON.stringify(videoCollection.videos, null, 2));
            
            console.log(`✅ Created videos for ${videoCollection.subjectCode}`);
        }
    }

    buildDownloadQueue() {
        console.log('🔧 Building unified download queue...');
        
        // Load previous progress
        this.loadProgress();
        
        // Extract files from all sources
        const dotnotesFiles = this.extractFilesFromDotnotes();
        const fifteenFourteenFiles = this.extractFilesFromFifteenFourteen();
        const studyXFiles = this.extractFilesFromStudyX();
        
        // Combine all files
        const allFiles = [...dotnotesFiles, ...fifteenFourteenFiles, ...studyXFiles];
        
        // Create download tasks grouped by subject
        const subjectGroups = {};
        
        for (const file of allFiles) {
            if (!subjectGroups[file.subjectCode]) {
                subjectGroups[file.subjectCode] = {};
            }
            
            if (!subjectGroups[file.subjectCode][file.targetFolder]) {
                subjectGroups[file.subjectCode][file.targetFolder] = [];
            }
            
            // Skip if already completed
            const fileKey = `${file.source}_${file.fileName}`;
            if (this.completedFiles.has(fileKey)) {
                this.stats.skippedFiles++;
                continue;
            }
            
            const filePath = path.join(
                this.contentDir,
                file.subjectCode,
                file.targetFolder,
                file.fileName
            );
            
            subjectGroups[file.subjectCode][file.targetFolder].push({
                downloadUrl: file.downloadUrl,
                filePath,
                fileName: file.fileName,
                originalName: file.originalName,
                source: file.source,
                subjectCode: file.subjectCode,
                targetFolder: file.targetFolder
            });
        }
        
        // Flatten into download queue
        for (const [subjectCode, folders] of Object.entries(subjectGroups)) {
            for (const [folderName, files] of Object.entries(folders)) {
                this.downloadQueue.push(...files);
            }
        }
        
        this.stats.totalFiles = this.downloadQueue.length;
        
        console.log(`📊 Download queue built:`);
        console.log(`   📁 Total subjects: ${Object.keys(subjectGroups).length}`);
        console.log(`   📄 Total files: ${this.downloadQueue.length}`);
        console.log(`   ⏭️ Already completed: ${this.stats.skippedFiles}`);
        
        return subjectGroups;
    }

    async downloadAllContent() {
        console.log('🚀 UNIFIED CONTENT DOWNLOADER STARTING...');
        console.log('='.repeat(80));
        
        // Load all data sources
        if (!await this.loadDataSources()) {
            console.error('❌ Failed to load data sources. Exiting.');
            return;
        }
        
        // Build download queue
        const subjectGroups = this.buildDownloadQueue();
        
        // Create syllabus and video files
        const syllabusData = this.extractSyllabusData();
        const videoData = this.extractVideoData();
        
        this.createSyllabusFiles(syllabusData);
        this.createVideoFiles(videoData);
        
        if (this.downloadQueue.length === 0) {
            console.log('✅ No files to download. All files already completed or no valid files found.');
            return;
        }
        
        console.log(`\n📊 Configuration:`);
        console.log(`   📁 Output directory: ${this.contentDir}`);
        console.log(`   🔄 Concurrent downloads: ${this.concurrentDownloads}`);
        console.log(`   ⏱️ Request delay: ${this.requestDelay}ms`);
        console.log(`   ⏸️ Pause duration: ${this.pauseDuration / 60000} minutes`);
        console.log(`   🔁 Retry attempts: ${this.retryAttempts}`);
        console.log(`   🚨 Max errors before pause: ${this.maxErrorsBeforePause}`);
        
        // Start downloads
        this.stats.startTime = new Date().toISOString();
        await this.processDownloadQueue();
        
        // Final report
        this.generateReport();
    }

    generateReport() {
        const endTime = new Date();
        const startTime = new Date(this.stats.startTime);
        const duration = (endTime - startTime) / 1000;
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 DOWNLOAD COMPLETE - FINAL REPORT');
        console.log('='.repeat(80));
        console.log(`⏱️  Total time: ${this.formatTime(duration)}`);
        console.log(`📄 Total files processed: ${this.stats.totalFiles}`);
        console.log(`✅ Successfully downloaded: ${this.stats.downloadedFiles}`);
        console.log(`⏭️  Skipped files: ${this.stats.skippedFiles}`);
        console.log(`❌ Error files: ${this.stats.errorFiles}`);
        console.log(`💾 Total downloaded size: ${this.formatFileSize(this.stats.downloadedSize)}`);
        console.log(`⏸️  Total pauses due to errors: ${this.stats.pausedForErrors}`);
        
        if (this.stats.errors.length > 0) {
            console.log(`\n❌ Errors encountered:`);
            this.stats.errors.slice(0, 10).forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
            
            if (this.stats.errors.length > 10) {
                console.log(`   ... and ${this.stats.errors.length - 10} more errors`);
            }
        }
        
        console.log('\n✅ Download process completed!');
        console.log(`📁 Files organized in: ${this.contentDir}`);
        
        // Save final progress
        this.saveProgress();
    }
}

// Usage
async function main() {
    const downloader = new UnifiedContentDownloader({
        outputDir: './Content',
        concurrentDownloads: 10,
        pauseDuration: 30 * 60 * 1000, // 30 minutes
        retryAttempts: 3,
        requestDelay: 500
    });
    
    await downloader.downloadAllContent();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default UnifiedContentDownloader;
