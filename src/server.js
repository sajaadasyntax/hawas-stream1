const port = process.env.PORT || 3000;
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Backup stream URLs in case the main one fails
const backupStreamUrls = [
    "https://uk24freenew.listen2myradio.com/live.mp3?typeportmount=s1_14899_stream_645397155",
    "https://stream-152.zeno.fm/5q54r1ukxp8uv?zs=TxN8UxQNTHGxGz_-FeHZ4g"
];
let streamUrl = backupStreamUrls[0];
let currentBackupIndex = 0;
let lastSuccessfulUrl = null;

// Increase default timeout for axios
axios.defaults.timeout = 15000;

// Function to test if a URL is accessible with better timeout handling
async function testStreamUrl(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // Increased timeout

        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 5000,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': '*/*',
                'Range': 'bytes=0-8192',
                'Connection': 'keep-alive'
            },
            validateStatus: function (status) {
                return status >= 200 && status < 300 || status === 206;
            },
            maxRedirects: 5
        });

        clearTimeout(timeoutId);

        // Get a small chunk of data to verify it's actually streaming
        const chunk = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                response.data.destroy();
                reject(new Error('Data timeout'));
            }, 3000); // Increased data timeout

            response.data.once('data', chunk => {
                clearTimeout(timeout);
                response.data.destroy();
                resolve(chunk);
            });

            response.data.once('error', err => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        return chunk.length > 0;
    } catch (error) {
        console.log(`Test failed for URL ${url}:`, error.message);
        return false;
    }
}

// Function to switch to next backup URL with retry logic
async function switchToNextBackup() {
    // If we have a last successful URL and it's different from current, try it first
    if (lastSuccessfulUrl && lastSuccessfulUrl !== streamUrl) {
        if (await testStreamUrl(lastSuccessfulUrl)) {
            streamUrl = lastSuccessfulUrl;
            console.log('Switched back to last known working URL:', streamUrl);
            return;
        }
    }

    // Try each backup URL in sequence
    const startIndex = currentBackupIndex;
    do {
        currentBackupIndex = (currentBackupIndex + 1) % backupStreamUrls.length;
        const nextUrl = backupStreamUrls[currentBackupIndex];
        
        console.log('Testing backup URL:', nextUrl);
        if (await testStreamUrl(nextUrl)) {
            streamUrl = nextUrl;
            console.log('Switched to working backup URL:', streamUrl);
            return;
        }
    } while (currentBackupIndex !== startIndex);

    // If no URLs work, keep the current one and log the error
    console.log('No working URLs found, keeping current URL');
}

// Function to extract stream URL from the source page with improved error handling
async function updateStreamUrl() {
    try {
        console.log('Attempting to update stream URL...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // Increased timeout for initial fetch

        const response = await axios.get('https://923fm.radiostream321.com/', {
            timeout: 8000,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            maxRedirects: 5
        });

        clearTimeout(timeoutId);
        
        const html = response.data;
        const match = html.match(/https:\/\/[^"'\s]+\.mp3[^"'\s]*/);
        
        if (match) {
            const newUrl = match[0];
            console.log('Found new stream URL:', newUrl);
            
            // Test the new URL
            const isAccessible = await testStreamUrl(newUrl);
            if (isAccessible) {
                lastSuccessfulUrl = streamUrl; // Store the last working URL
                streamUrl = newUrl;
                console.log('Stream URL updated successfully');
            } else {
                console.log('New URL not accessible, testing current and backup URLs...');
                
                // Test current URL first
                if (await testStreamUrl(streamUrl)) {
                    console.log('Current URL still working, keeping it');
                    return;
                }
                
                await switchToNextBackup();
            }
        } else {
            console.log('No stream URL found in the page, testing current and backup URLs...');
            if (!await testStreamUrl(streamUrl)) {
                await switchToNextBackup();
            }
        }
    } catch (error) {
        console.error('Error updating stream URL:', error.message);
        // Only switch to backup if current URL isn't working
        if (!await testStreamUrl(streamUrl)) {
            await switchToNextBackup();
        }
    }
}

// Update stream URL every 3 minutes instead of 2
setInterval(updateStreamUrl, 3 * 60 * 1000);

// Initial update with retry mechanism
(async function initialUpdate() {
    try {
        await updateStreamUrl();
    } catch (error) {
        console.error('Initial update failed, retrying in 10 seconds...');
        setTimeout(initialUpdate, 10000);
    }
})();

// Function to serve static files
const serveStaticFile = (res, filePath, contentType) => {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(content, 'utf-8');
        }
    });
};

// Create HTTP server with proper error handling
const server = http.createServer(async (req, res) => {
    try {
        // Set CORS headers for all responses
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

        // Handle OPTIONS request for CORS
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Route handling
        if (req.url === '/' || req.url.startsWith('/?')) {
            serveStaticFile(res, path.join(__dirname, '../index.html'), 'text/html');
        } else if (req.url.startsWith('/stream')) {
            try {
                console.log('Stream request received, using URL:', streamUrl);
                
                // Test the current stream URL before serving
                const isUrlWorking = await testStreamUrl(streamUrl);
                if (!isUrlWorking) {
                    console.log('Current stream URL not working, switching to backup...');
                    await switchToNextBackup();
                }

                const userAgent = req.headers['user-agent'] || '';
                const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
                
                // Set appropriate headers for streaming
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'identity;q=1, *;q=0',
                    'Range': 'bytes=0-',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                };

                // Add mobile-specific headers
                if (isMobile) {
                    headers['Cache-Control'] = 'no-store';
                    headers['X-Playback-Session-Id'] = Date.now().toString();
                }

                const response = await axios({
                    method: 'get',
                    url: streamUrl,
                    responseType: 'stream',
                    timeout: isMobile ? 20000 : 15000, // Increased timeouts
                    headers: headers,
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status >= 200 && status < 300 || status === 206;
                    }
                });

                // Set response headers
                const responseHeaders = {
                    'Content-Type': 'audio/mpeg',
                    'Transfer-Encoding': 'chunked',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'X-Content-Type-Options': 'nosniff',
                    'Access-Control-Allow-Origin': '*',
                    'Connection': 'keep-alive',
                    'Accept-Ranges': 'bytes'
                };

                if (isMobile) {
                    responseHeaders['X-Playback-Session-Id'] = Date.now().toString();
                }

                res.writeHead(200, responseHeaders);

                // Set up stream error handling with improved cleanup
                let streamEnded = false;
                let dataReceived = false;
                let streamTimeout = null;
                let keepAliveInterval = null;

                const cleanup = () => {
                    if (streamTimeout) {
                        clearTimeout(streamTimeout);
                        streamTimeout = null;
                    }
                    if (keepAliveInterval) {
                        clearInterval(keepAliveInterval);
                        keepAliveInterval = null;
                    }
                    if (!streamEnded) {
                        streamEnded = true;
                        try {
                            response.data.destroy();
                        } catch (e) {
                            console.error('Error during stream cleanup:', e);
                        }
                    }
                };

                // Set initial stream timeout
                streamTimeout = setTimeout(() => {
                    if (!dataReceived) {
                        console.error('Stream timeout - no data received');
                        cleanup();
                        if (!res.headersSent) {
                            res.writeHead(504);
                        }
                        res.end();
                    }
                }, 15000); // Increased timeout

                // Keep-alive interval to prevent connection drops
                keepAliveInterval = setInterval(() => {
                    if (!streamEnded && dataReceived) {
                        res.write('');
                    }
                }, 30000);

                // Handle client disconnect
                req.on('close', cleanup);
                req.on('end', cleanup);
                
                // Handle stream errors
                response.data.on('error', (error) => {
                    console.error('Stream error:', error);
                    cleanup();
                    if (!res.headersSent) {
                        res.writeHead(500);
                    }
                    res.end();
                });

                // Monitor data flow
                response.data.on('data', (chunk) => {
                    if (!dataReceived) {
                        dataReceived = true;
                        if (streamTimeout) {
                            clearTimeout(streamTimeout);
                            streamTimeout = null;
                        }
                    }
                });

                // Pipe the stream with error handling
                response.data.pipe(res).on('error', (error) => {
                    console.error('Pipe error:', error);
                    cleanup();
                });

            } catch (error) {
                console.error('Error connecting to radio stream:', error.message);
                res.writeHead(500);
                res.end('Error connecting to radio stream');
            }
        } else {
            // Handle 404
            res.writeHead(404);
            res.end('Not found');
        }
    } catch (error) {
        console.error('Server error:', error);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    }
});

// Error handling for the server
server.on('error', (error) => {
    console.error('Server error:', error);
});

server.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }    
    console.log(`Server is running on port ${port}`);
}); 