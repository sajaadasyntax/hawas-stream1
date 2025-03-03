const port = process.env.PORT || 3000;
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Backup stream URL in case the main one fails
const backupStreamUrl = "https://uk24freenew.listen2myradio.com/live.mp3?typeportmount=s1_14899_stream_645397155";
let streamUrl = backupStreamUrl;

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
            
            // Verify the new URL is accessible
            try {
                const testResponse = await axios.head(newUrl, { timeout: 5000 });
                if (testResponse.status === 200) {
                    streamUrl = newUrl;
                    console.log('Stream URL updated successfully');
                } else {
                    console.log('New URL not accessible, keeping current URL');
                }
            } catch (error) {
                console.error('Error testing new URL:', error.message);
                console.log('Keeping current URL');
            }
        } else {
            console.log('No stream URL found in the page');
        }
    } catch (error) {
        console.error('Error updating stream URL:', error.message);
        if (!streamUrl) {
            console.log('Falling back to backup URL');
            streamUrl = backupStreamUrl;
        }
    }
}

// Update stream URL every 5 minutes
setInterval(updateStreamUrl, 5 * 60 * 1000);
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