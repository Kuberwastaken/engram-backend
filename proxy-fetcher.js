#!/usr/bin/env node

/**
 * Proxy Fetcher - Fetches and validates random proxies from public lists
 */

import axios from 'axios';
import fs from 'fs';

class ProxyFetcher {    constructor(options = {}) {
        this.maxProxies = options.maxProxies || 10; // Maximum number of proxies to select
        this.timeout = options.timeout || 5000; // 5 seconds timeout for validation (reduced from 10)
        this.proxyLists = [
            {
                url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
                type: 'socks5',
                name: 'SOCKS5-List'
            },
            {
                url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
                type: 'http',
                name: 'HTTP-List'
            }
        ];
        
        this.axios = axios.create({
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
    }

    async fetchProxyList(listConfig) {
        try {
            console.log(`📡 Fetching ${listConfig.name} from ${listConfig.url}...`);
            const response = await this.axios.get(listConfig.url);
            
            const proxies = response.data
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .map(line => {
                    const [host, port] = line.split(':');
                    if (host && port && !isNaN(port)) {
                        return {
                            type: listConfig.type,
                            host: host.trim(),
                            port: parseInt(port.trim()),
                            name: `${listConfig.type.toUpperCase()}-${host}:${port}`,
                            source: listConfig.name
                        };
                    }
                    return null;
                })
                .filter(proxy => proxy !== null);

            console.log(`✅ Found ${proxies.length} ${listConfig.type.toUpperCase()} proxies`);
            return proxies;
        } catch (error) {
            console.log(`❌ Failed to fetch ${listConfig.name}: ${error.message}`);
            return [];
        }
    }    async testProxy(proxy) {
        try {
            // For SOCKS proxies, do a basic connectivity test
            if (proxy.type === 'socks5' || proxy.type === 'socks4') {
                // Test SOCKS proxy with a simple HTTP request using tunnel
                const SocksProxyAgent = (await import('socks-proxy-agent')).SocksProxyAgent;
                const agent = new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`);
                
                const testAxios = axios.create({
                    timeout: this.timeout,
                    httpsAgent: agent,
                    httpAgent: agent,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                try {
                    const response = await testAxios.get('http://httpbin.org/ip');
                    if (response.status === 200) {
                        return { 
                            success: true, 
                            responseTime: Date.now(),
                            ip: response.data.origin
                        };
                    }
                } catch (socksError) {
                    return { 
                        success: false, 
                        reason: `SOCKS: ${socksError.code || socksError.message.substring(0, 30)}`
                    };
                }
            } else if (proxy.type === 'http' || proxy.type === 'https') {
                // Test HTTP proxies
                const testAxios = axios.create({
                    timeout: this.timeout,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    proxy: {
                        protocol: 'http',
                        host: proxy.host,
                        port: proxy.port
                    }
                });

                const response = await testAxios.get('http://httpbin.org/ip');
                
                if (response.status === 200) {
                    return { 
                        success: true, 
                        responseTime: Date.now(),
                        ip: response.data.origin
                    };
                } else {
                    return { success: false, reason: `HTTP ${response.status}` };
                }
            }
        } catch (error) {
            return { 
                success: false, 
                reason: error.code || error.message.substring(0, 50)
            };
        }
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }    async fetchRandomProxies() {
        console.log('🔍 Fetching proxy lists...');
        console.log('ℹ️  Note: Most public proxies are expected to fail - this is normal!');
        console.log('ℹ️  The system will use untested proxies and Tor as fallbacks.');
        
        // Fetch all proxy lists
        const allProxies = [];
        for (const listConfig of this.proxyLists) {
            const proxies = await this.fetchProxyList(listConfig);
            allProxies.push(...proxies);
        }

        if (allProxies.length === 0) {
            console.log('❌ No proxies found from any source');
            return [];
        }

        console.log(`📊 Total proxies found: ${allProxies.length}`);

        // Shuffle and select random proxies
        const shuffledProxies = this.shuffleArray(allProxies);
        const selectedProxies = shuffledProxies.slice(0, this.maxProxies);

        console.log(`🎯 Selected ${selectedProxies.length} random proxies for rotation`);// Test a larger subset of proxies but with priority for SOCKS5
        const socksProxies = selectedProxies.filter(p => p.type === 'socks5');
        const httpProxies = selectedProxies.filter(p => p.type === 'http');
        
        // Test more SOCKS5 proxies since they're often more reliable
        const socksToTest = Math.min(socksProxies.length, 8);
        const httpToTest = Math.min(httpProxies.length, 3);
        
        console.log(`🧪 Testing ${socksToTest} SOCKS5 and ${httpToTest} HTTP proxies for connectivity...`);
        
        const workingProxies = [];
        
        // Test SOCKS5 proxies first
        for (let i = 0; i < socksToTest; i++) {
            const proxy = socksProxies[i];
            console.log(`   Testing ${proxy.name}...`);
            
            const result = await this.testProxy(proxy);
            if (result.success) {
                console.log(`   ✅ ${proxy.name} - Working (IP: ${result.ip})`);
                workingProxies.push(proxy);
            } else {
                console.log(`   ❌ ${proxy.name} - Failed (${result.reason})`);
            }
        }
        
        // Test HTTP proxies
        for (let i = 0; i < httpToTest; i++) {
            const proxy = httpProxies[i];
            console.log(`   Testing ${proxy.name}...`);
            
            const result = await this.testProxy(proxy);
            if (result.success) {
                console.log(`   ✅ ${proxy.name} - Working (IP: ${result.ip})`);
                workingProxies.push(proxy);
            } else {
                console.log(`   ❌ ${proxy.name} - Failed (${result.reason})`);
            }
        }

        // Add remaining untested proxies (they might work but we didn't test them)
        const tested = [...socksProxies.slice(0, socksToTest), ...httpProxies.slice(0, httpToTest)];
        const untestedProxies = selectedProxies.filter(p => !tested.includes(p));
          // Return working proxies first, then untested ones
        const finalProxies = [...workingProxies, ...untestedProxies];
        
        if (workingProxies.length === 0) {
            console.log(`⚠️  No proxies passed testing (this is expected with public lists)`);
            console.log(`📋 Final proxy list: ${finalProxies.length} untested proxies + Tor fallback`);
            console.log(`ℹ️  The downloader will try each proxy and rotate when needed`);
        } else {
            console.log(`📋 Final proxy list: ${workingProxies.length} tested working, ${untestedProxies.length} untested`);
        }
        
        return finalProxies;
    }

    async saveProxiesToFile(proxies, filename = 'fetched-proxies.json') {
        const proxyData = {
            fetchedAt: new Date().toISOString(),
            totalCount: proxies.length,
            proxies: proxies
        };
        
        fs.writeFileSync(filename, JSON.stringify(proxyData, null, 2));
        console.log(`💾 Saved ${proxies.length} proxies to ${filename}`);
    }

    async loadProxiesFromFile(filename = 'fetched-proxies.json') {
        try {
            if (!fs.existsSync(filename)) {
                return null;
            }
            
            const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
            const fetchedAt = new Date(data.fetchedAt);
            const now = new Date();
            const ageHours = (now - fetchedAt) / (1000 * 60 * 60);
            
            // Use cached proxies if they're less than 6 hours old
            if (ageHours < 6) {
                console.log(`📂 Using cached proxies from ${filename} (${ageHours.toFixed(1)}h old)`);
                return data.proxies;
            } else {
                console.log(`⏰ Cached proxies are too old (${ageHours.toFixed(1)}h), fetching fresh ones`);
                return null;
            }
        } catch (error) {
            console.log(`⚠️ Failed to load cached proxies: ${error.message}`);
            return null;
        }
    }

    async getProxies(useCache = true) {
        let proxies = null;
        
        // Try to use cached proxies first
        if (useCache) {
            proxies = await this.loadProxiesFromFile();
        }
        
        // Fetch fresh proxies if no valid cache
        if (!proxies) {
            proxies = await this.fetchRandomProxies();
            if (proxies.length > 0) {
                await this.saveProxiesToFile(proxies);
            }
        }
        
        // Always include Tor as a fallback
        const torProxy = {
            type: 'socks5',
            host: '127.0.0.1',
            port: 9050,
            name: 'Tor-SOCKS5-Fallback',
            source: 'Local'
        };
        
        proxies.push(torProxy);
        
        return proxies;
    }
}

// CLI usage
async function main() {
    const fetcher = new ProxyFetcher({
        maxProxies: 15, // Fetch up to 15 random proxies
        timeout: 8000   // 8 second timeout for testing
    });
    
    const proxies = await fetcher.getProxies(process.argv.includes('--no-cache'));
      console.log('\n' + '='.repeat(60));
    console.log('📊 PROXY FETCH COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total proxies available: ${proxies.length}`);
    console.log('ℹ️  Note: Failed testing is normal for public proxies');
    console.log('ℹ️  The downloader will try each proxy during rotation');
    console.log('');
    
    proxies.forEach((proxy, index) => {
        console.log(`${index + 1}. ${proxy.name} (${proxy.source})`);
    });
    
    console.log('\n✅ Proxies ready for use! (Tor is the most reliable)');
}

// Run if this file is executed directly
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
    console.log('🚀 Starting Proxy Fetcher...');
    main().catch(console.error);
}

export default ProxyFetcher;
