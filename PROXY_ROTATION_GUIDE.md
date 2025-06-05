# Proxy and Tor Rotation Documentation

This document explains how to use the proxy and Tor rotation functionality added to the unified content downloader to avoid rate limiting.

## Overview

The downloader now includes automatic proxy rotation that switches proxies every 20 downloads (configurable) to help avoid rate limiting from Google Drive and other sources.

## Features

- **Automatic Proxy Rotation**: Switches between configured proxies every N downloads
- **Tor Support**: Built-in support for Tor SOCKS5 proxy
- **Multiple Proxy Types**: Supports SOCKS5, SOCKS4, HTTP, and HTTPS proxies
- **Network Error Recovery**: Automatically rotates proxy on network/proxy errors
- **Progress Tracking**: Shows current proxy and rotation countdown in progress display

## Configuration

### Default Configuration (Tor Only)

By default, the downloader is configured to use Tor proxy rotation:

```javascript
const downloader = new UnifiedContentDownloader({
    useProxyRotation: true,
    proxyRotationInterval: 20,
    proxyList: [
        { type: 'socks5', host: '127.0.0.1', port: 9050, name: 'Tor-SOCKS5' }
    ]
});
```

### Custom Proxy Configuration

You can configure multiple proxies:

```javascript
const downloader = new UnifiedContentDownloader({
    useProxyRotation: true,
    proxyRotationInterval: 15, // Rotate every 15 downloads
    proxyList: [
        { type: 'socks5', host: '127.0.0.1', port: 9050, name: 'Tor-SOCKS5' },
        { type: 'socks5', host: 'proxy1.example.com', port: 1080, name: 'SOCKS5-Proxy-1' },
        { type: 'http', host: 'proxy2.example.com', port: 8080, name: 'HTTP-Proxy-1' },
    ]
});
```

### Disable Proxy Rotation

To disable proxy rotation and use direct connection:

```javascript
const downloader = new UnifiedContentDownloader({
    useProxyRotation: false
});
```

## Setup Instructions

### Local Development Setup

1. **Install Tor Browser or Tor Service**:
   - **Windows**: Download and install Tor Browser from https://www.torproject.org/
   - **Linux**: `sudo apt-get install tor`
   - **macOS**: `brew install tor`

2. **Configure Tor** (if using Tor service directly):
   ```bash
   # Edit /etc/tor/torrc or create ~/.torrc
   SocksPort 9050
   SocksPolicy accept *
   ```

3. **Start Tor**:
   - **Tor Browser**: Just run the browser (proxy available at 127.0.0.1:9050)
   - **Tor Service**: `tor` or `sudo systemctl start tor`

4. **Test Tor Connection**:
   ```bash
   curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/
   ```

### GitHub Actions Setup

The GitHub Actions workflow automatically:
1. Installs Tor
2. Configures it for optimal downloading
3. Starts the service
4. Tests the connection

No additional setup required for GitHub Actions.

## Usage

### Testing Proxy Rotation

Run the test script to verify proxy rotation is working:

```bash
node test-proxy-rotation.js
```

This will test 12 connections with proxy rotation every 3 requests.

### Running the Downloader

```bash
node run-downloader.js
```

The downloader will automatically use proxy rotation based on the configuration.

## Monitoring

### Progress Display

The progress display now includes proxy information:

```
📊 Progress: 45/1000 (4.5%) | ✅40 ⏭️3 ❌2 | 💾125.3MB | ⏸️0 pauses | 🔄 Tor-SOCKS5 (18 until rotation)
```

- `🔄 Tor-SOCKS5`: Current active proxy
- `(18 until rotation)`: Downloads remaining before next proxy rotation

### Log Messages

The downloader provides detailed logging:

```
🔄 Proxy rotation enabled - switching every 20 downloads
📡 Available proxies: 1
   1. Tor-SOCKS5 (socks5://127.0.0.1:9050)
🔄 Switched to proxy: Tor-SOCKS5 (socks5://127.0.0.1:9050)
🔄 Reached 20 downloads, rotating proxy...
🔄 Network/proxy error detected, rotating proxy and retrying: ECONNRESET
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useProxyRotation` | boolean | `true` | Enable/disable proxy rotation |
| `proxyRotationInterval` | number | `20` | Downloads before rotating proxy |
| `proxyList` | array | Tor proxy | List of proxy configurations |

### Proxy Configuration Object

```javascript
{
    type: 'socks5',           // 'socks5', 'socks4', 'http', 'https'
    host: '127.0.0.1',        // Proxy hostname/IP
    port: 9050,               // Proxy port
    name: 'Tor-SOCKS5'        // Display name for logging
}
```

## Troubleshooting

### Common Issues

1. **"No proxies configured" Warning**:
   - Check that `proxyList` is not empty
   - Verify proxy configuration syntax

2. **"Failed to set proxy" Error**:
   - Check if proxy service is running
   - Verify host/port are correct
   - Test proxy manually with curl

3. **"Network/proxy error detected"**:
   - Proxy may be down or overloaded
   - Downloader will automatically try next proxy
   - Check proxy service logs

4. **Tor Connection Issues**:
   - Ensure Tor is running: `ps aux | grep tor`
   - Check Tor logs: `sudo journalctl -u tor`
   - Test manually: `curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/`

### Testing Proxy Connectivity

```bash
# Test SOCKS5 proxy
curl --socks5-hostname 127.0.0.1:9050 https://httpbin.org/ip

# Test HTTP proxy
curl --proxy http://proxy.example.com:8080 https://httpbin.org/ip
```

## Performance Considerations

- **Tor Speed**: Tor can be slower than direct connections
- **Proxy Rotation Delay**: 2-3 second delay after each rotation
- **Concurrent Downloads**: Reduced to prevent proxy overload
- **Error Recovery**: Automatic proxy switching on network errors

## Security Notes

- Tor provides anonymity but may be slower
- Use trusted proxy services only
- Monitor proxy logs for suspicious activity
- Consider proxy geographic location for best performance

## Advanced Configuration

### Multiple Tor Instances

Run multiple Tor instances on different ports:

```bash
# Instance 1 (default)
tor --SocksPort 9050

# Instance 2
tor --SocksPort 9051 --DataDirectory /tmp/tor2

# Instance 3  
tor --SocksPort 9052 --DataDirectory /tmp/tor3
```

Then configure multiple Tor proxies:

```javascript
proxyList: [
    { type: 'socks5', host: '127.0.0.1', port: 9050, name: 'Tor-1' },
    { type: 'socks5', host: '127.0.0.1', port: 9051, name: 'Tor-2' },
    { type: 'socks5', host: '127.0.0.1', port: 9052, name: 'Tor-3' }
]
```

### Proxy Authentication

For proxies requiring authentication, modify the proxy URL:

```javascript
// SOCKS5 with auth
{ type: 'socks5', host: 'username:password@proxy.com', port: 1080, name: 'Auth-SOCKS5' }

// HTTP with auth  
{ type: 'http', host: 'username:password@proxy.com', port: 8080, name: 'Auth-HTTP' }
```
