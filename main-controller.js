const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORRECT Auth Server URL 
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://tiktok-bot-auth.up.railway.app';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ✅ Global variables for job tracking
global.runningJobs = {};
global.permanentOnlineBots = new Map();
global.permanentOnlineInterval = null;

// ✅ FIXED TOKEN VERIFICATION - No redirect loops
async function verifyToken(req, res, next) {
    try {
        const token = req.query.token || req.body.token;
        
        if (!token) {
            console.log('❌ No token found');
            return res.status(401).json({ success: false, message: 'Token required' });
        }

        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        }, { 
            timeout: 5000,
            transformResponse: [function (data) {
                try {
                    return JSON.parse(data);
                } catch (e) {
                    return { success: false, valid: false };
                }
            }]
        });

        if (response.data.success && response.data.valid) {
            req.user = { 
                username: response.data.username,
                role: response.data.role 
            };
            next();
        } else {
            console.log('❌ Invalid token');
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
    } catch (error) {
        console.log('❌ Token verification failed:', error.message);
        return res.status(401).json({ success: false, message: 'Token verification failed' });
    }
}

// ✅ ENHANCED API Call Wrapper
async function safeApiCall(apiCall) {
    try {
        const response = await apiCall();
        
        // Check if response is HTML instead of JSON
        const contentType = response.headers['content-type'];
        if (contentType && contentType.includes('text/html')) {
            throw new Error('Server returned HTML instead of JSON');
        }
        
        return response.data;
    } catch (error) {
        console.error('API Call Error:', error.message);
        throw error;
    }
}

// ✅ GET INSTANCES FROM AUTH SERVER (With better error handling)
async function getInstancesFromAuthServer(token) {
    try {
        const data = await safeApiCall(() => 
            axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=${token}`, {
                timeout: 5000
            })
        );
        
        if (data.success) {
            return data.instances || [];
        }
        return [];
    } catch (error) {
        console.log('Error fetching instances from auth server:', error.message);
        return [];
    }
}

// ✅ VIDEO INFO EXTRACTION FUNCTION
function extractVideoInfo(url) {
    let cleanUrl = url.split('?')[0].trim();
    
    // Standard TikTok URL
    const standardMatch = cleanUrl.match(/tiktok\.com\/@[^\/]+\/video\/(\d{19})/);
    if (standardMatch) {
        return { id: standardMatch[1], type: 'STANDARD' };
    }
    
    // Short URL
    const shortUrlMatch = cleanUrl.match(/(vm|vt)\.tiktok\.com\/([A-Za-z0-9]+)/);
    if (shortUrlMatch) {
        return { id: shortUrlMatch[2], type: 'SHORT_URL' };
    }
    
    // Video ID only
    const videoIdMatch = cleanUrl.match(/\/(\d{19})(\/|$)/);
    if (videoIdMatch) {
        return { id: videoIdMatch[1], type: 'VIDEO_ID_ONLY' };
    }
    
    return { id: null, type: 'UNKNOWN' };
}

// ✅ GET TIKTOK VIDEO STATS FUNCTION
async function getTikTokVideoStats(videoId) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'www.tiktok.com',
            path: `/@tiktok/video/${videoId}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk.toString();
            });

            res.on('end', () => {
                const stats = extractStatsFromHTML(data);
                resolve(stats);
            });
        });

        req.on('error', (error) => {
            console.log('❌ TikTok stats request error:', error.message);
            resolve({ views: 0, likes: 0, comments: 0, author: 'Unknown', title: 'No Title' });
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            resolve({ views: 0, likes: 0, comments: 0, author: 'Unknown', title: 'No Title' });
        });
        req.end();
    });
}

// ✅ EXTRACT STATS FROM HTML FUNCTION
function extractStatsFromHTML(html) {
    const stats = {
        views: 0,
        likes: 0,
        comments: 0,
        author: 'Unknown',
        title: 'No Title',
        thumbnail: ''
    };

    try {
        // Extract views
        const viewMatch = html.match(/"playCount":(\d+)/) || html.match(/"viewCount":(\d+)/);
        if (viewMatch) stats.views = parseInt(viewMatch[1]);

        // Extract likes
        const likeMatch = html.match(/"diggCount":(\d+)/) || html.match(/"likeCount":(\d+)/);
        if (likeMatch) stats.likes = parseInt(likeMatch[1]);

        // Extract comments
        const commentMatch = html.match(/"commentCount":(\d+)/);
        if (commentMatch) stats.comments = parseInt(commentMatch[1]);

        // Extract author
        const authorMatch = html.match(/"author":"([^"]*)"/) || html.match(/"uniqueId":"([^"]*)"/);
        if (authorMatch) stats.author = authorMatch[1];

        // Extract title
        const titleMatch = html.match(/"title":"([^"]*)"/) || html.match(/"description":"([^"]*)"/);
        if (titleMatch && titleMatch[1] !== 'Company') stats.title = titleMatch[1].substring(0, 100);

        // Extract thumbnail
        const thumbnailMatch = html.match(/"cover":"([^"]*)"/);
        if (thumbnailMatch) stats.thumbnail = thumbnailMatch[1];

    } catch (error) {
        console.log('❌ Error extracting stats from HTML:', error.message);
    }

    return stats;
}

// ✅ VIDEO MONITORING FUNCTION
function startVideoMonitoring(videoId, targetViews, token) {
    const checkInterval = setInterval(async () => {
        try {
            // Check if job is still running
            if (!global.runningJobs || !global.runningJobs[videoId] || !global.runningJobs[videoId].isRunning) {
                clearInterval(checkInterval);
                return;
            }

            // Get current views
            const currentStats = await getTikTokVideoStats(videoId);
            const currentViews = currentStats.views;

            // Update current views in running job
            global.runningJobs[videoId].currentViews = currentViews;
            global.runningJobs[videoId].lastChecked = new Date();

            // Calculate progress
            const progress = currentViews - global.runningJobs[videoId].startViews;
            const remaining = targetViews - currentViews;

            console.log(`📊 Video ${videoId}: ${currentViews}/${targetViews} (${progress} progress, ${remaining} remaining)`);

            // Check if target reached
            if (currentViews >= targetViews) {
                console.log(`🎯 TARGET REACHED for video ${videoId}! Stopping bots...`);
                
                // Stop all bots for this video
                global.runningJobs[videoId].isRunning = false;
                global.runningJobs[videoId].completedAt = new Date();
                global.runningJobs[videoId].status = 'COMPLETED';
                
                // Stop bots through instances
                try {
                    const instances = await getInstancesFromAuthServer(token);
                    const enabledInstances = instances.filter(inst => inst.enabled);
                    
                    for (const instance of enabledInstances) {
                        try {
                            await axios.post(`${instance.url}/stop`, {}, { timeout: 5000 });
                        } catch (error) {
                            // Ignore individual instance errors
                        }
                    }
                    console.log(`✅ All bots stopped for completed video: ${videoId}`);
                } catch (error) {
                    console.log('❌ Error stopping bots:', error.message);
                }
                
                clearInterval(checkInterval);
            }

        } catch (error) {
            console.log('❌ Monitoring error:', error.message);
        }
    }, 15000); // Check every 15 seconds to avoid rate limiting
}

// ✅ PERMANENT ONLINE SYSTEM - Bots kabhi offline nahi honge
function startPermanentOnlineSystem() {
    if (global.permanentOnlineInterval) {
        clearInterval(global.permanentOnlineInterval);
    }
    
    console.log('🔴🟢 Starting PERMANENT ONLINE SYSTEM...');
    
    global.permanentOnlineInterval = setInterval(async () => {
        try {
            await keepAllBotsPermanentlyOnline();
        } catch (error) {
            console.log('❌ Permanent online system error:', error.message);
        }
    }, 10000); // Check every 10 seconds
    
    console.log('✅ Permanent Online System Started - Bots will NEVER go offline');
}

// ✅ STOP PERMANENT ONLINE SYSTEM
function stopPermanentOnlineSystem() {
    if (global.permanentOnlineInterval) {
        clearInterval(global.permanentOnlineInterval);
        global.permanentOnlineInterval = null;
    }
    global.permanentOnlineBots.clear();
    console.log('🛑 Permanent Online System Stopped');
}

// ✅ KEEP ALL BOTS PERMANENTLY ONLINE
async function keepAllBotsPermanentlyOnline() {
    try {
        // Get all bot instances from auth server
        const instances = await getInstancesForSystem();
        
        if (instances.length === 0) {
            console.log('ℹ️ No bot instances found for permanent online system');
            return;
        }
        
        let onlineCount = 0;
        let restartedCount = 0;
        
        for (const instance of instances) {
            try {
                // Check if bot is responding
                const statusResponse = await axios.get(`${instance.url}/status`, {
                    timeout: 8000
                });
                
                const botStatus = statusResponse.data;
                
                // Update permanent online tracking
                if (!global.permanentOnlineBots.has(instance.id)) {
                    global.permanentOnlineBots.set(instance.id, {
                        instanceId: instance.id,
                        instanceUrl: instance.url,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        restartCount: 0,
                        alwaysOnline: true
                    });
                }
                
                const botInfo = global.permanentOnlineBots.get(instance.id);
                botInfo.lastSeen = new Date().toISOString();
                botInfo.currentStatus = botStatus;
                
                onlineCount++;
                
                // If bot is not running but should be, start it
                if (!botStatus.running && instance.enabled) {
                    console.log(`🔄 Auto-starting idle bot: ${instance.url}`);
                    
                    try {
                        // Start with minimal settings to keep it alive
                        await axios.post(`${instance.url}/start`, {
                            targetViews: 1000000, // Very high target to keep running
                            videoLink: 'https://www.tiktok.com/@tiktok/video/7106688751857945857', // Default video
                            mode: 'permanent'
                        }, { timeout: 15000 });
                        
                        botInfo.restartCount++;
                        restartedCount++;
                        console.log(`✅ Bot auto-started: ${instance.url} (Restart #${botInfo.restartCount})`);
                    } catch (startError) {
                        console.log(`❌ Failed to auto-start bot ${instance.url}:`, startError.message);
                    }
                }
                
            } catch (error) {
                console.log(`🔴 Bot ${instance.url} is OFFLINE - Attempting restart...`);
                
                // Bot is completely offline - try to restart
                try {
                    const botInfo = global.permanentOnlineBots.get(instance.id) || {
                        instanceId: instance.id,
                        instanceUrl: instance.url,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        restartCount: 0,
                        alwaysOnline: true
                    };
                    
                    // Try to start the bot
                    await axios.post(`${instance.url}/start`, {
                        targetViews: 1000000,
                        videoLink: 'https://www.tiktok.com/@tiktok/video/7106688751857945857',
                        mode: 'permanent_recovery'
                    }, { timeout: 20000 });
                    
                    botInfo.restartCount++;
                    botInfo.lastSeen = new Date().toISOString();
                    global.permanentOnlineBots.set(instance.id, botInfo);
                    
                    restartedCount++;
                    console.log(`✅ OFFLINE Bot RESTARTED: ${instance.url} (Recovery #${botInfo.restartCount})`);
                    
                } catch (restartError) {
                    console.log(`💀 CRITICAL: Bot ${instance.url} cannot be restarted:`, restartError.message);
                    
                    // Mark for special attention
                    const botInfo = global.permanentOnlineBots.get(instance.id) || {
                        instanceId: instance.id,
                        instanceUrl: instance.url,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        restartCount: 0,
                        alwaysOnline: true,
                        critical: true
                    };
                    
                    botInfo.critical = true;
                    botInfo.lastError = restartError.message;
                    global.permanentOnlineBots.set(instance.id, botInfo);
                }
            }
        }
        
        console.log(`📊 Permanent Online Stats: ${onlineCount} online, ${restartedCount} restarted`);
        
    } catch (error) {
        console.log('❌ Permanent online system critical error:', error.message);
    }
}

// ✅ GET INSTANCES FOR SYSTEM (Without user token)
async function getInstancesForSystem() {
    try {
        // For system operations, we need to get instances without user token
        const response = await axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=system_admin_2024`, {
            timeout: 10000
        });
        
        if (response.data.success) {
            return response.data.instances || [];
        }
        return [];
    } catch (error) {
        console.log('❌ System instances fetch failed:', error.message);
        return [];
    }
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

// ✅ DASHBOARD ROUTE
app.get('/dashboard', async (req, res) => {
    const token = req.query.token;
    
    if (!token) {
        return res.redirect(AUTH_SERVER_URL);
    }
    
    // Verify token before showing dashboard
    try {
        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        });
        
        if (response.data.success && response.data.valid) {
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        } else {
            res.redirect(AUTH_SERVER_URL);
        }
    } catch (error) {
        res.redirect(AUTH_SERVER_URL);
    }
});

// ✅ FIXED LOGOUT
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.body.token;
        
        // Notify auth server about logout
        if (token) {
            axios.post(`${AUTH_SERVER_URL}/api/global-logout`, {
                token: token
            }, { timeout: 3000 }).catch(err => {
                // Ignore errors
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Logged out successfully',
            redirect_url: `${AUTH_SERVER_URL}/login?message=logged_out`
        });
    } catch (error) {
        res.json({ 
            success: true, 
            redirect_url: `${AUTH_SERVER_URL}/login`
        });
    }
});

// ✅ GET VIDEO INFORMATION ROUTE
app.post('/api/get-video-info', verifyToken, async (req, res) => {
    try {
        const { videoLink, token } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        const videoInfo = extractVideoInfo(videoLink);
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        // Get current video stats
        const currentStats = await getTikTokVideoStats(videoInfo.id);
        
        res.json({
            success: true,
            videoInfo: {
                id: videoInfo.id,
                currentViews: currentStats.views,
                currentLikes: currentStats.likes,
                currentComments: currentStats.comments,
                author: currentStats.author,
                title: currentStats.title,
                thumbnail: currentStats.thumbnail
            }
        });
    } catch (error) {
        console.log('❌ Get video info error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to get video information' });
    }
});

// ✅ ENHANCED START-ALL ROUTE WITH MONITORING
app.post('/api/start-all', verifyToken, async (req, res) => {
    try {
        const { videoLink, targetViews, token, currentViews } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        if (enabledInstances.length === 0) {
            return res.json({ success: false, message: 'No bot instances available' });
        }

        const videoInfo = extractVideoInfo(videoLink);
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        // Calculate target views: currentViews + additional target
        const currentViewsNum = parseInt(currentViews) || 0;
        const targetViewsNum = parseInt(targetViews) || 0;
        const finalTarget = currentViewsNum + targetViewsNum;

        // Store target in global variable for monitoring
        global.runningJobs = global.runningJobs || {};
        global.runningJobs[videoInfo.id] = {
            videoId: videoInfo.id,
            videoLink: videoLink,
            startViews: currentViewsNum,
            targetViews: finalTarget,
            currentViews: currentViewsNum,
            startTime: new Date(),
            isRunning: true,
            status: 'RUNNING'
        };

        const results = [];
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: finalTarget, // Send final target to bots
                    videoLink: videoLink,
                    mode: 'persistent' // New mode for persistent running
                }, { timeout: 10000 });
                results.push({ instance: instance.id, success: true, message: 'Started' });
            } catch (error) {
                results.push({ instance: instance.id, success: false, message: 'Failed: ' + error.message });
            }
        }

        // Start monitoring for this video
        startVideoMonitoring(videoInfo.id, finalTarget, token);

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${enabledInstances.length} started`,
            finalTarget: finalTarget,
            videoId: videoInfo.id,
            results: results
        });
    } catch (error) {
        console.log('❌ Start-all error:', error.message);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// ✅ STOP ALL ROUTE
app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        // Stop all running jobs
        if (global.runningJobs) {
            Object.keys(global.runningJobs).forEach(videoId => {
                global.runningJobs[videoId].isRunning = false;
                global.runningJobs[videoId].status = 'STOPPED';
                global.runningJobs[videoId].stoppedAt = new Date();
            });
        }
        
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/stop`, {}, { 
                    timeout: 10000
                });
            } catch (error) {
                // Continue even if some instances fail
                console.log(`Instance ${instance.url} stop failed:`, error.message);
            }
        }
        
        res.json({ success: true, message: 'All instances stopped' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ STATUS ALL ROUTE
app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const allStatus = [];

        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, { 
                    timeout: 10000
                });
                
                allStatus.push({ 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`,
                    url: instance.url,
                    enabled: instance.enabled, 
                    status: response.data, 
                    online: true 
                });
            } catch (error) {
                allStatus.push({ 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`, 
                    url: instance.url,
                    enabled: instance.enabled, 
                    status: null, 
                    online: false 
                });
            }
        }

        const totals = {
            success: allStatus.reduce((sum, bot) => sum + (bot.status?.success || 0), 0),
            fails: allStatus.reduce((sum, bot) => sum + (bot.status?.fails || 0), 0),
            reqs: allStatus.reduce((sum, bot) => sum + (bot.status?.reqs || 0), 0),
            rps: allStatus.reduce((sum, bot) => sum + (parseFloat(bot.status?.rps) || 0), 0),
            onlineBots: allStatus.filter(bot => bot.online && bot.enabled).length,
            totalBots: instances.filter(inst => inst.enabled).length
        };
        
        totals.successRate = totals.reqs > 0 ? ((totals.success / totals.reqs) * 100).toFixed(1) + '%' : '0%';

        res.json({
            success: true,
            instances: allStatus,
            totals: totals
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ MONITORING STATUS ROUTE
app.get('/api/monitoring-status', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.query;
        
        if (!global.runningJobs || !global.runningJobs[videoId]) {
            return res.json({ success: false, isRunning: false });
        }

        const job = global.runningJobs[videoId];
        const currentStats = await getTikTokVideoStats(videoId);

        const progress = currentStats.views - job.startViews;
        const remaining = job.targetViews - currentStats.views;
        const percentage = ((currentStats.views - job.startViews) / (job.targetViews - job.startViews) * 100).toFixed(1);

        res.json({
            success: true,
            isRunning: job.isRunning,
            startViews: job.startViews,
            targetViews: job.targetViews,
            currentViews: currentStats.views,
            progress: progress,
            remaining: remaining,
            percentage: percentage,
            startTime: job.startTime,
            status: job.status || 'RUNNING',
            videoInfo: {
                author: currentStats.author,
                title: currentStats.title
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ GET ALL RUNNING JOBS ROUTE
app.get('/api/running-jobs', verifyToken, async (req, res) => {
    try {
        const jobs = global.runningJobs || {};
        const jobList = [];

        for (const [videoId, job] of Object.entries(jobs)) {
            if (job.isRunning) {
                const currentStats = await getTikTokVideoStats(videoId);
                const progress = currentStats.views - job.startViews;
                const remaining = job.targetViews - currentStats.views;
                const percentage = ((currentStats.views - job.startViews) / (job.targetViews - job.startViews) * 100).toFixed(1);

                jobList.push({
                    videoId: videoId,
                    videoLink: job.videoLink,
                    startViews: job.startViews,
                    targetViews: job.targetViews,
                    currentViews: currentStats.views,
                    progress: progress,
                    remaining: remaining,
                    percentage: percentage,
                    startTime: job.startTime,
                    status: job.status,
                    author: currentStats.author,
                    title: currentStats.title
                });
            }
        }

        res.json({
            success: true,
            totalJobs: jobList.length,
            jobs: jobList
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ PERMANENT ONLINE CONTROL APIS
app.post('/api/system/permanent-online/start', (req, res) => {
    try {
        startPermanentOnlineSystem();
        res.json({ 
            success: true, 
            message: '🟢 Permanent Online System STARTED - Bots will never go offline',
            status: 'active'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/system/permanent-online/stop', (req, res) => {
    try {
        stopPermanentOnlineSystem();
        res.json({ 
            success: true, 
            message: '🛑 Permanent Online System STOPPED',
            status: 'inactive'
        });
    } catch (error) {
        res.status(500).json({ success false, message: 'Server error' });
    }
});

app.get('/api/system/permanent-online/status', (req, res) => {
    try {
        const activeBots = Array.from(global.permanentOnlineBots.values());
        
        res.json({
            success: true,
            system: {
                isActive: !!global.permanentOnlineInterval,
                totalBots: activeBots.length,
                onlineBots: activeBots.filter(bot => !bot.critical).length,
                criticalBots: activeBots.filter(bot => bot.critical).length,
                totalRestarts: activeBots.reduce((sum, bot) => sum + (bot.restartCount || 0), 0),
                bots: activeBots.map(bot => ({
                    instanceId: bot.instanceId,
                    instanceUrl: bot.instanceUrl,
                    firstSeen: bot.firstSeen,
                    lastSeen: bot.lastSeen,
                    restartCount: bot.restartCount || 0,
                    status: bot.critical ? 'critical' : 'online',
                    lastError: bot.lastError || null
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Main Controller is running',
        timestamp: new Date().toISOString(),
        runningJobs: Object.keys(global.runningJobs || {}).length,
        permanentOnline: !!global.permanentOnlineInterval
    });
});

// ✅ INSTANCES ROUTE
app.get('/api/instances', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        
        const safeInstances = instances.map(instance => ({
            id: instance.id,
            name: `Bot Instance ${instance.id.substring(0, 8)}`,
            status: 'active',
            addedAt: instance.addedAt,
            url: instance.url
        }));
        
        res.json({ success: true, instances: safeInstances });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ Enhanced Error Handling: Enabled`);
    console.log(`📱 Mobile Compatible: Yes`);
    console.log(`🎯 Video Monitoring: Active`);
    console.log(`📊 Progress Tracking: Enabled`);
    
    // ✅ START PERMANENT ONLINE SYSTEM ON BOOT
    setTimeout(() => {
        startPermanentOnlineSystem();
    }, 10000); // Start 10 seconds after server boot
});
