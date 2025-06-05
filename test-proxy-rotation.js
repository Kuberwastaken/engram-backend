#!/usr/bin/env node

/**
 * Test script for proxy rotation functionality
 * This script tests the proxy rotation without downloading actual files
 */

import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

class ProxyRotationTest {
    constructor() {
        this.proxyList = [
            { type: 'socks5', host: '127.0.0.1', port: 9050, name: 'Tor-SOCKS5' },
            // Add more test proxies here if available
        ];
        this.currentProxyIndex = 0;
        this.downloadCount = 0;
        this.proxyRotationInterval = 3; // Test every 3 requests
        
        this.axios = axios.create({
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
    }

    rotateProxy() {
        if (this.proxyList.length === 0) {
            console.log('⚠️ No proxies configured');
            return;
        }
        
        const proxy = this.proxyList[this.currentProxyIndex];
        
        try {
            let agent;
            if (proxy.type === 'socks5' || proxy.type === 'socks4') {
                const proxyUrl = `${proxy.type}://${proxy.host}:${proxy.port}`;
                agent = new SocksProxyAgent(proxyUrl);
            } else if (proxy.type === 'http' || proxy.type === 'https') {
                const proxyUrl = `${proxy.type}://${proxy.host}:${proxy.port}`;
                agent = new HttpsProxyAgent(proxyUrl);
            }
            
            if (agent) {
                this.axios.defaults.httpsAgent = agent;
                this.axios.defaults.httpAgent = agent;
                console.log(`🔄 Switched to proxy: ${proxy.name} (${proxy.type}://${proxy.host}:${proxy.port})`);
            }
            
            // Move to next proxy for next rotation
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;
            
        } catch (error) {
            console.log(`⚠️ Failed to set proxy ${proxy.name}: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            console.log(`📡 Testing connection #${this.downloadCount + 1}...`);
            
            // Test with a simple endpoint
            const response = await this.axios.get('https://httpbin.org/ip', {
                timeout: 10000
            });
            
            console.log(`✅ Connection successful - IP: ${response.data.origin}`);
            return true;
        } catch (error) {
            console.log(`❌ Connection failed: ${error.message}`);
            return false;
        }
    }

    async checkProxyRotation() {
        this.downloadCount++;
        if (this.downloadCount % this.proxyRotationInterval === 0) {
            console.log(`🔄 Reached ${this.downloadCount} requests, rotating proxy...`);
            this.rotateProxy();
            
            // Add a small delay after proxy rotation
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    async runTest(numTests = 10) {
        console.log('🧪 Starting proxy rotation test...');
        console.log(`📊 Will test ${numTests} connections with rotation every ${this.proxyRotationInterval} requests`);
        console.log(`🔧 Available proxies: ${this.proxyList.length}`);
        
        // Set initial proxy
        this.rotateProxy();
        
        let successCount = 0;
        
        for (let i = 0; i < numTests; i++) {
            await this.checkProxyRotation();
            
            const success = await this.testConnection();
            if (success) successCount++;
            
            // Delay between tests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST RESULTS');
        console.log('='.repeat(50));
        console.log(`Total tests: ${numTests}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${numTests - successCount}`);
        console.log(`Success rate: ${((successCount / numTests) * 100).toFixed(1)}%`);
        
        if (successCount === numTests) {
            console.log('✅ All tests passed! Proxy rotation is working correctly.');
        } else if (successCount > 0) {
            console.log('⚠️ Some tests failed. Check proxy configuration.');
        } else {
            console.log('❌ All tests failed. Check if Tor is running and proxy is accessible.');
        }
    }
}

// Run the test
async function main() {
    const tester = new ProxyRotationTest();
    await tester.runTest(12); // Test 12 connections (4 rotations with interval of 3)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default ProxyRotationTest;
