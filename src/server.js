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

// Function to test if a URL is accessible
async function testStreamUrl(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 3000,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': '*/*',
                'Range': 'bytes=0-8192' // Only request first 8KB to test
            }
        });

        clearTimeout(timeoutId);

        // Get a small chunk of data to verify it's actually streaming
        const chunk = await new Promise((resolve, reject) => {
            response.data.once('data', chunk => {
                response.data.destroy(); // Clean up the stream
                resolve(chunk);
            });
            response.data.once('error', reject);
        });

        return chunk.length > 0;
    } catch (error) {
        console.log(`Test failed for URL ${url}:`, error.message);
        return false;
    }
}

// Function to switch to next backup URL
async function switchToNextBackup() {
    currentBackupIndex = (currentBackupIndex + 1) % backupStreamUrls.length;
    streamUrl = backupStreamUrls[currentBackupIndex];
    console.log('Switched to backup URL:', streamUrl);
}

// Function to extract stream URL from the source page
async function updateStreamUrl() {
    try {
        console.log('Attempting to update stream URL...');
        const response = await axios.get('https://923fm.radiostream321.com/', {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const html = response.data;
        // Extract the stream URL using regex
        const match = html.match(/https:\/\/[^"'\s]+\.mp3[^"'\s]*/);
        if (match) {
            const newUrl = match[0];
            console.log('Found new stream URL:', newUrl);
            
            // Test the new URL
            const isAccessible = await testStreamUrl(newUrl);
            if (isAccessible) {
                streamUrl = newUrl;
                console.log('Stream URL updated successfully');
            } else {
                console.log('New URL not accessible, testing backup URLs...');
                
                // Test all backup URLs
                for (let url of backupStreamUrls) {
                    console.log('Testing backup URL:', url);
                    if (await testStreamUrl(url)) {
                        streamUrl = url;
                        console.log('Switched to working backup URL:', url);
                        return;
                    }
                }
                
                // If current URL is not working and no backup works, rotate through backups
                await switchToNextBackup();
            }
        } else {
            console.log('No stream URL found in the page, testing backup URLs...');
            // Test current URL first
            if (!await testStreamUrl(streamUrl)) {
                await switchToNextBackup();
            }
        }
    } catch (error) {
        console.error('Error updating stream URL:', error.message);
        // Test current URL and switch to backup if needed
        if (!await testStreamUrl(streamUrl)) {
            await switchToNextBackup();
        }
    }
}

// Update stream URL every 2 minutes
setInterval(updateStreamUrl, 2 * 60 * 1000);
// Initial update
updateStreamUrl();

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

// Create HTTP server
const server = http.createServer(async (req, res) => {
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Route handling
    if (req.url === '/' || req.url.startsWith('/?')) {
        // Serve the index.html file from root directory
        serveStaticFile(res, path.join(__dirname, '../index.html'), 'text/html');
    } else if (req.url.startsWith('/stream')) {
        try {
            console.log('Stream request received, using URL:', streamUrl);
            const response = await axios({
                method: 'get',
                url: streamUrl,
                responseType: 'stream',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'identity;q=1, *;q=0',
                    'Range': 'bytes=0-'
                },
                maxRedirects: 5
            });

            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff'
            });

            // Pipe the stream directly to the response
            response.data.pipe(res);

            // Handle client disconnect
            req.on('close', () => {
                console.log('Client disconnected, cleaning up stream');
                response.data.destroy();
            });

            // Handle errors
            response.data.on('error', (error) => {
                console.error('Stream error:', error);
                res.end();
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
});

server.listen(port, (err) => {
    if (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }    
    console.log(`Server is running on port ${port}`);
}); 