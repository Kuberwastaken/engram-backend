# Unified Content Downloader

A comprehensive script to download and organize study materials from multiple JSON sources (Dotnotes, FifteenFourteen, StudyX, Syllabus, and Videos).

## Features

- **Multi-source download**: Downloads from Dotnotes, FifteenFourteen, and StudyX
- **Intelligent organization**: Files are organized by subject and category
- **Prefix management**: Adds appropriate prefixes (DN_, FFT_, SX_) to identify sources
- **Google Drive error detection**: Detects 1.96KB error files and pauses automatically
- **Rate limiting**: Configurable concurrent downloads with delays
- **Progress tracking**: Saves progress and supports resume
- **Retry mechanism**: Automatic retries with exponential backoff

## File Organization

The script creates a `Content` directory with the following structure:

```
Content/
├── {SubjectCode}/
│   ├── Syllabus/
│   │   └── syllabus.json
│   ├── Notes/
│   │   ├── DN_{filename}    (from Dotnotes)
│   │   ├── FFT_{filename}   (from FifteenFourteen)
│   │   └── SX_{filename}    (from StudyX)
│   ├── PYQs/
│   │   ├── DN_{filename}    (from Dotnotes)
│   │   ├── FFT_{filename}   (from FifteenFourteen)
│   │   └── SX_{filename}    (from StudyX)
│   ├── Assignment/
│   │   ├── DN_{filename}    (from Dotnotes)
│   │   └── SX_{filename}    (from StudyX)
│   ├── Books/
│   │   ├── {filename}       (from StudyX, no prefix)
│   │   └── {filename}       (from Dotnotes, no prefix)
│   ├── Lab/
│   │   ├── {filename}       (from Dotnotes, no prefix)
│   │   └── {filename}       (from StudyX, no prefix)
│   ├── Akash/
│   │   └── {filename}       (from Dotnotes & StudyX, no prefix)
│   ├── Practicals/
│   │   └── {filename}       (from Dotnotes viva & StudyX practicals, no prefix)
│   └── Videos/
│       ├── videos.json
│       └── DN_{filename}    (from Dotnotes video files)
```

## Usage

### Basic Usage

```bash
node run-downloader.js
```

### Advanced Usage

```javascript
import UnifiedContentDownloader from './unified-content-downloader.js';

const downloader = new UnifiedContentDownloader({
    outputDir: './Content',           // Output directory
    concurrentDownloads: 10,          // Concurrent downloads (default: 10)
    pauseDuration: 30 * 60 * 1000,    // Pause duration in ms (default: 30 min)
    retryAttempts: 3,                 // Retry attempts (default: 3)
    requestDelay: 500                 // Delay between downloads in ms (default: 500)
});

await downloader.downloadAllContent();
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `outputDir` | `'./Content'` | Directory where files will be organized |
| `concurrentDownloads` | `10` | Number of simultaneous downloads |
| `pauseDuration` | `30 * 60 * 1000` | Pause duration when Google Drive errors detected (ms) |
| `retryAttempts` | `3` | Number of retry attempts per failed download |
| `requestDelay` | `500` | Delay between starting downloads (ms) |

## Error Handling

### Google Drive Rate Limiting
- Detects 1.96KB error files (Google Drive quota exceeded)
- Automatically pauses for 30 minutes when 5 consecutive errors occur
- Commits successfully downloaded files before pausing
- Resumes automatically after pause period

### File Validation
- Validates downloaded files for completeness
- Removes corrupted or incomplete downloads
- Retries failed downloads with exponential backoff

### Progress Tracking
- Saves progress to `download-progress.json`
- Supports resuming interrupted downloads
- Tracks statistics and errors

## Data Sources

### Dotnotes.json
- **Notes**: Prefix `DN_`, saved to `Notes/`
- **PYQs**: Prefix `DN_`, saved to `PYQs/`
- **Assignment**: Prefix `DN_`, saved to `Assignment/`
- **Lab**: No prefix, saved to `Lab/`
- **Books**: No prefix, saved to `Books/`
- **Akash**: No prefix, saved to `Akash/`
- **Syllabus**: Prefix `DN_`, saved to `Syllabus/`
- **Videos**: Prefix `DN_`, saved to `Videos/`
- **Viva**: No prefix, saved to `Practicals/`

### FifteenFourteen.json
- **Notes**: Prefix `FFT_`, saved to `Notes/`
- **PYQs**: Prefix `FFT_`, saved to `PYQs/`

### StudyX.json
- **Notes**: Prefix `SX_`, saved to `Notes/`
- **PYQs**: Prefix `SX_`, saved to `PYQs/`
- **Assignment**: Prefix `SX_`, saved to `Assignment/`
- **Books**: No prefix, saved to `Books/`
- **Lab**: No prefix, saved to `Lab/`
- **Akash**: No prefix, saved to `Akash/`
- **Practicals**: No prefix, saved to `Practicals/`

### Syllabus.json
- Creates `syllabus.json` in each subject's `Syllabus/` folder

### Videos.json
- Creates `videos.json` in each subject's `Videos/` folder

## Monitoring

The script provides real-time progress updates:

```
📊 Progress: 1250/5000 (25.0%) | ✅1100 ⏭️50 ❌100 | 💾2.3GB | ⏸️2 pauses
```

- **Progress**: Current/Total files (percentage)
- **✅**: Successfully downloaded files
- **⏭️**: Skipped files (already exist)
- **❌**: Error files
- **💾**: Total downloaded size
- **⏸️**: Number of automatic pauses due to errors

## Requirements

- Node.js with ES modules support
- `axios` for HTTP requests
- JSON mapping files in `./Mappings/` directory:
  - `Dotnotes.json`
  - `FifteenFourteen.json`
  - `StudyX.json`
  - `syllabus.json`
  - `videos.json`

## Installation

1. Ensure you have the required JSON files in the `Mappings/` directory
2. Install dependencies: `npm install axios`
3. Run the downloader: `node run-downloader.js`

## Output

After completion, you'll have:
- Organized content by subject and category
- Progress file for resuming interrupted downloads
- Detailed completion report with statistics
- Error log for troubleshooting failed downloads
