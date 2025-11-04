const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORRECT Auth Server URL 
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://tiktok-bot-auth.up.railway.app';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Global variables for monitoring
global.runningJobs = {};

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

// ✅ PERMANENT ONLINE SYSTEM - Bots kabhi offline nahi honge
let permanentOnlineInterval = null;
const permanentOnlineBots = new Map();

// ✅ START PERMANENT ONLINE SYSTEM
function startPermanentOnlineSystem() {
    if (permanentOnlineInterval) {
        clearInterval(permanentOnlineInterval);
    }
    
    console.log('🔴🟢 Starting PERMANENT ONLINE SYSTEM...');
    
    permanentOnlineInterval = setInterval(async () => {
        try {
            await keepAllBotsPermanentlyOnline();
        } catch (error) {
            console.log('❌ Permanent online system error:', error.message);
        }
    }, 5000); // Check every 5 seconds
    
    console.log('✅ Permanent Online System Started - Bots will NEVER go offline');
}

// ✅ STOP PERMANENT ONLINE SYSTEM
function stopPermanentOnlineSystem() {
    if (permanentOnlineInterval) {
        clearInterval(permanentOnlineInterval);
        permanentOnlineInterval = null;
    }
    permanentOnlineBots.clear();
    console.log('🛑 Permanent Online System Stopped');
}

// ✅ KEEP ALL BOTS PERMANENTLY ONLINE
async function keepAllBotsPermanentlyOnline() {
    try {
        // Get all bot instances from auth server (using a default token for system operations)
        const instances = await getInstancesForSystem();
        
        if (instances.length === 0) {
            console.log('ℹ️ No bot instances found for permanent online system');
            return;
        }
        
        console.log(`🔧 Permanent Online: Checking ${instances.length} bots...`);
        
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
                if (!permanentOnlineBots.has(instance.id)) {
                    permanentOnlineBots.set(instance.id, {
                        instanceId: instance.id,
                        instanceUrl: instance.url,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        restartCount: 0,
                        alwaysOnline: true
                    });
                }
                
                const botInfo = permanentOnlineBots.get(instance.id);
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
                    const botInfo = permanentOnlineBots.get(instance.id) || {
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
                    permanentOnlineBots.set(instance.id, botInfo);
                    
                    restartedCount++;
                    console.log(`✅ OFFLINE Bot RESTARTED: ${instance.url} (Recovery #${botInfo.restartCount})`);
                    
                } catch (restartError) {
                    console.log(`💀 CRITICAL: Bot ${instance.url} cannot be restarted:`, restartError.message);
                    
                    // Mark for special attention
                    const botInfo = permanentOnlineBots.get(instance.id) || {
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
                    permanentOnlineBots.set(instance.id, botInfo);
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
        // This is a simplified version - you might need to adjust based on your auth system
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

// ✅ HELPER FUNCTIONS - Add these to your main-controller.js

// ✅ UPDATED: Extract Video Info with Short URL Resolution
function extractVideoInfo(url) {
    let cleanUrl = url.split('?')[0].trim();
    
    console.log('🔍 Analyzing URL:', cleanUrl);
    
    // TYPE 1: Standard TikTok URL with video ID (19 digits)
    const standardMatch = cleanUrl.match(/tiktok\.com\/@[^\/]+\/video\/(\d{19})/);
    if (standardMatch) {
        console.log('✅ Standard URL detected, Video ID:', standardMatch[1]);
        return { id: standardMatch[1], type: 'STANDARD' };
    }
    
    // TYPE 2: Short URL (vm.tiktok.com, vt.tiktok.com) - NEED RESOLUTION
    const shortUrlMatch = cleanUrl.match(/(vm|vt)\.tiktok\.com\/([A-Za-z0-9]+)/);
    if (shortUrlMatch) {
        console.log('🔄 Short URL detected, code:', shortUrlMatch[2]);
        return { 
            id: shortUrlMatch[2], 
            type: 'SHORT_URL',
            shortCode: shortUrlMatch[2],
            originalUrl: cleanUrl
        };
    }
    
    // TYPE 3: Just the 19-digit video ID in the URL
    const videoIdMatch = cleanUrl.match(/\/(\d{19})(\/|$)/);
    if (videoIdMatch) {
        console.log('✅ Video ID detected:', videoIdMatch[1]);
        return { id: videoIdMatch[1], type: 'VIDEO_ID_ONLY' };
    }
    
    console.log('❌ No video ID found in URL');
    return { id: null, type: 'UNKNOWN' };
}

// ✅ NEW: Resolve Short URL to get actual Video ID
function resolveShortUrl(shortCode) {
    return new Promise((resolve) => {
        console.log('🔄 Resolving short URL:', shortCode);
        
        const options = {
            hostname: 'vm.tiktok.com',
            path: `/${shortCode}/`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            }
        };

        const req = https.request(options, (res) => {
            console.log('📡 Short URL response status:', res.statusCode);
            
            // Follow redirect to get final URL
            const finalUrl = res.headers.location;
            console.log('🔗 Redirect URL:', finalUrl);
            
            if (finalUrl) {
                // Extract video ID from final URL
                const videoIdMatch = finalUrl.match(/\/(\d{19})/);
                if (videoIdMatch) {
                    console.log('✅ Resolved to Video ID:', videoIdMatch[1]);
                    resolve(videoIdMatch[1]);
                } else {
                    console.log('❌ No video ID in redirect URL');
                    resolve(null);
                }
            } else {
                console.log('❌ No redirect location found');
                resolve(null);
            }
            
            // Consume the response body
            res.on('data', () => {});
            res.on('end', () => {});
        });

        req.on('error', (error) => {
            console.log('❌ Short URL resolve error:', error.message);
            resolve(null);
        });
        
        req.setTimeout(8000, () => {
            console.log('❌ Short URL resolve timeout');
            req.destroy();
            resolve(null);
        });
        
        req.end();
    });
}

// ✅ UPDATED: Get TikTok Video Stats with Short URL Support
// ✅ UPDATED: Get TikTok Video Stats with Auto Resolution
// ✅ COMPLETE: Get TikTok Video Stats with Auto Resolution
function getTikTokVideoStats(videoInfo) {
    return new Promise((resolve) => {
        console.log('📊 Getting stats for:', videoInfo);
        
        // If it's a short URL, resolve it first and get stats with real ID
        if (videoInfo.type === 'SHORT_URL') {
            console.log('🔄 Short URL detected, resolving...');
            
            resolveShortUrl(videoInfo.shortCode)
                .then(resolvedVideoId => {
                    if (resolvedVideoId) {
                        console.log('✅ Short URL resolved to REAL Video ID:', resolvedVideoId);
                        // Get stats with the REAL video ID
                        getTikTokVideoStatsDirect(resolvedVideoId)
                            .then(stats => {
                                // Add resolved ID to stats
                                stats.resolvedVideoId = resolvedVideoId;
                                stats.originalShortCode = videoInfo.shortCode;
                                stats.resolved = true;
                                console.log('🎯 Stats with resolved ID:', stats);
                                resolve(stats);
                            })
                            .catch((error) => {
                                console.log('❌ Error getting stats with resolved ID:', error);
                                resolve(getFallbackStats());
                            });
                    } else {
                        console.log('❌ Short URL resolution failed');
                        const fallbackStats = getFallbackStats();
                        fallbackStats.resolved = false;
                        resolve(fallbackStats);
                    }
                })
                .catch((error) => {
                    console.log('❌ Short URL resolution error:', error);
                    const fallbackStats = getFallbackStats();
                    fallbackStats.resolved = false;
                    resolve(fallbackStats);
                });
            return;
        }

        // For standard video IDs, directly get stats
        console.log('🎯 Getting stats for standard Video ID:', videoInfo.id);
        getTikTokVideoStatsDirect(videoInfo.id)
            .then(stats => {
                stats.resolved = true;
                stats.resolvedVideoId = videoInfo.id;
                console.log('✅ Stats for standard ID:', stats);
                resolve(stats);
            })
            .catch((error) => {
                console.log('❌ Error getting stats for standard ID:', error);
                const fallbackStats = getFallbackStats();
                fallbackStats.resolved = false;
                resolve(fallbackStats);
            });
    });
}

// ✅ COMPLETE: Get TikTok Video Stats Direct (for resolved IDs)
function getTikTokVideoStatsDirect(videoId) {
    return new Promise((resolve, reject) => {
        console.log('🎯 Fetching stats directly for Video ID:', videoId);
        
        const options = {
            hostname: 'www.tiktok.com',
            path: `/@tiktok/video/${videoId}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk.toString();
            });

            res.on('end', () => {
                console.log('✅ Received data length:', data.length);
                
                if (data.length < 1000) {
                    console.log('❌ Response too short, likely blocked');
                    reject(new Error('Response too short'));
                    return;
                }
                
                try {
                    const stats = extractStatsFromHTML(data);
                    console.log('📈 Extracted stats:', stats);
                    resolve(stats);
                } catch (error) {
                    console.log('❌ Error parsing stats:', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.log('❌ Request error:', error.message);
            reject(error);
        });
        
        req.setTimeout(15000, () => {
            console.log('❌ Request timeout');
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// ✅ COMPLETE: Extract Stats from HTML
function extractStatsFromHTML(html) {
    const stats = {
        views: 0,
        likes: 0,
        comments: 0,
        author: 'Unknown',
        title: 'No Title',
        resolved: false,
        resolvedVideoId: null
    };

    console.log('🔍 Extracting stats from HTML...');

    try {
        // Method 1: Extract from JSON-LD
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (jsonLdMatch) {
            try {
                const jsonData = JSON.parse(jsonLdMatch[1]);
                console.log('✅ JSON-LD found:', jsonData);
                
                if (jsonData.interactionStatistic) {
                    stats.views = parseInt(jsonData.interactionStatistic.userInteractionCount) || 0;
                }
                if (jsonData.name && jsonData.name !== 'Company') {
                    stats.title = jsonData.name;
                }
                if (jsonData.author && jsonData.author.name) {
                    stats.author = jsonData.author.name;
                }
            } catch (e) {
                console.log('❌ JSON-LD parse error');
            }
        }

        // Method 2: Extract from meta tags
        const viewMatch = html.match(/"playCount":(\d+)/) || html.match(/"viewCount":(\d+)/);
        if (viewMatch) {
            stats.views = parseInt(viewMatch[1]) || 0;
            console.log('✅ Views from meta:', stats.views);
        }

        const likeMatch = html.match(/"diggCount":(\d+)/) || html.match(/"likeCount":(\d+)/);
        if (likeMatch) {
            stats.likes = parseInt(likeMatch[1]) || 0;
            console.log('✅ Likes from meta:', stats.likes);
        }

        const commentMatch = html.match(/"commentCount":(\d+)/);
        if (commentMatch) {
            stats.comments = parseInt(commentMatch[1]) || 0;
            console.log('✅ Comments from meta:', stats.comments);
        }

        const authorMatch = html.match(/"author":"([^"]*)"/) || html.match(/"uniqueId":"([^"]*)"/);
        if (authorMatch) {
            stats.author = authorMatch[1] || 'Unknown';
            console.log('✅ Author from meta:', stats.author);
        }

        const titleMatch = html.match(/"title":"([^"]*)"/) || html.match(/"description":"([^"]*)"/);
        if (titleMatch && titleMatch[1] !== 'Company') {
            stats.title = titleMatch[1] || 'No Title';
            console.log('✅ Title from meta:', stats.title);
        }

        // Method 3: Try to find video ID in the HTML
        const videoIdMatch = html.match(/"videoId":"(\d+)"/);
        if (videoIdMatch) {
            stats.resolvedVideoId = videoIdMatch[1];
            console.log('✅ Video ID found in HTML:', stats.resolvedVideoId);
        }

    } catch (error) {
        console.log('❌ Error in extractStatsFromHTML:', error);
    }

    console.log('📊 Final stats:', stats);
    return stats;
}

// ✅ COMPLETE: Get Fallback Stats
function getFallbackStats() {
    return {
        views: 0,
        likes: 0,
        comments: 0,
        author: 'Unknown',
        title: 'No Title',
        resolved: false,
        resolvedVideoId: null
    };
}

// ✅ COMPLETE: Resolve Short URL
function resolveShortUrl(shortCode) {
    return new Promise((resolve) => {
        console.log('🔄 Resolving short URL:', shortCode);
        
        const options = {
            hostname: 'vm.tiktok.com',
            path: `/${shortCode}/`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            }
        };

        const req = https.request(options, (res) => {
            console.log('📡 Short URL response status:', res.statusCode);
            console.log('📡 Response headers:', res.headers);
            
            // Follow redirect to get final URL
            const finalUrl = res.headers.location;
            console.log('🔗 Redirect URL:', finalUrl);
            
            if (finalUrl) {
                // Extract video ID from final URL
                const videoIdMatch = finalUrl.match(/\/(\d{19})/);
                if (videoIdMatch) {
                    console.log('✅ Resolved to Video ID:', videoIdMatch[1]);
                    resolve(videoIdMatch[1]);
                } else {
                    console.log('❌ No video ID in redirect URL');
                    resolve(null);
                }
            } else {
                console.log('❌ No redirect location found');
                resolve(null);
            }
            
            // Consume the response body
            res.on('data', () => {});
            res.on('end', () => {});
        });

        req.on('error', (error) => {
            console.log('❌ Short URL resolve error:', error.message);
            resolve(null);
        });
        
        req.setTimeout(10000, () => {
            console.log('❌ Short URL resolve timeout');
            req.destroy();
            resolve(null);
        });
        
        req.end();
    });
}

// ✅ COMPLETE: Start Video Monitoring with Auto-Restart
function startVideoMonitoring(videoId, targetViews, originalVideoLink) {
    let restartCount = 0;
    const MAX_RESTARTS = 10; // Maximum 10 times restart
    
    console.log(`🎯 Starting monitoring for video ${videoId}, target: ${targetViews}`);
    
    const checkInterval = setInterval(async () => {
        try {
            // Check if job is still running
            if (!global.runningJobs || !global.runningJobs[videoId]) {
                console.log(`🛑 Monitoring stopped - job removed`);
                clearInterval(checkInterval);
                return;
            }

            const job = global.runningJobs[videoId];
            
            // Get current REAL views from TikTok
            console.log(`📊 Checking current views for ${videoId}...`);
            const currentStats = await getTikTokVideoStats({ id: videoId, type: 'MONITORING' });
            const currentViews = currentStats.views;
            
            console.log(`📈 Video ${videoId}: Current=${currentViews}, Target=${targetViews}, Progress=${currentViews - job.startViews}`);
            
            // Update job with current progress
            job.currentViews = currentViews;
            job.progress = currentViews - job.startViews;
            job.remaining = targetViews - currentViews;
            
            // Check if target reached
            if (currentViews >= targetViews) {
                console.log(`🎯 TARGET REACHED! Video ${videoId}: ${currentViews}/${targetViews}`);
                
                // Stop all bots for this video
                job.isRunning = false;
                job.status = 'COMPLETED';
                job.completedAt = new Date();
                
                console.log(`✅ Successfully completed target for video ${videoId}`);
                clearInterval(checkInterval);
                return;
            }
            
            // ✅ CHECK IF BOTS ARE STILL RUNNING
            let botsRunning = false;
            try {
                const instances = await getInstancesForSystem();
                for (const instance of instances) {
                    if (instance.enabled) {
                        try {
                            const status = await axios.get(`${instance.url}/status`, { timeout: 5000 });
                            if (status.data && status.data.running) {
                                botsRunning = true;
                                break;
                            }
                        } catch (error) {
                            // Instance might be offline
                        }
                    }
                }
            } catch (error) {
                console.log('❌ Error checking bot status:', error.message);
            }
            
            // ✅ AUTO-RESTART LOGIC
            if (!botsRunning && job.isRunning && restartCount < MAX_RESTARTS) {
                console.log(`🔄 BOTS STOPPED! Auto-restarting... (Attempt ${restartCount + 1}/${MAX_RESTARTS})`);
                
                restartCount++;
                job.restartCount = restartCount;
                job.lastRestart = new Date();
                
                try {
                    // Restart all bots
                    const instances = await getInstancesForSystem();
                    const enabledInstances = instances.filter(inst => inst.enabled);
                    
                    let restartSuccess = 0;
                    for (const instance of enabledInstances) {
                        try {
                            await axios.post(`${instance.url}/start`, {
                                targetViews: targetViews,
                                videoLink: originalVideoLink,
                                mode: 'auto_restart'
                            }, { timeout: 10000 });
                            restartSuccess++;
                        } catch (error) {
                            console.log(`❌ Failed to restart instance ${instance.url}`);
                        }
                    }
                    
                    if (restartSuccess > 0) {
                        console.log(`✅ Auto-restart successful: ${restartSuccess} bots restarted`);
                        job.status = `RESTARTED_${restartCount}`;
                    } else {
                        console.log(`❌ Auto-restart failed: No bots could be restarted`);
                        job.status = 'RESTART_FAILED';
                    }
                    
                } catch (restartError) {
                    console.log(`❌ Auto-restart error:`, restartError.message);
                    job.status = 'RESTART_ERROR';
                }
            }
            
            // Stop if max restarts reached but target not achieved
            if (restartCount >= MAX_RESTARTS && currentViews < targetViews) {
                console.log(`💀 MAX RESTARTS REACHED! Video ${videoId}: ${currentViews}/${targetViews}`);
                job.isRunning = false;
                job.status = 'MAX_RESTARTS_REACHED';
                clearInterval(checkInterval);
            }

        } catch (error) {
            console.log('❌ Monitoring error:', error.message);
        }
    }, 10000); // Check every 10 seconds
}

// Routes
app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

// ✅ FIXED DASHBOARD ROUTE
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

// ✅ FIXED LOGOUT - Simple and effective
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

// ✅ Route 1: Get Video Information
// ✅ UPDATED: Get Video Information with Short URL Support
// ✅ UPDATED: Get Video Information with Auto Resolution
app.post('/api/get-video-info', verifyToken, async (req, res) => {
    try {
        const { videoLink, token } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        console.log('🎯 Processing video link:', videoLink);
        const videoInfo = extractVideoInfo(videoLink);
        
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link!' });
        }

        console.log('📊 Video Info:', videoInfo);
        
        // Get current video stats (with auto resolution for short URLs)
        const currentStats = await getTikTokVideoStats(videoInfo);
        
        console.log('📈 Stats retrieved:', currentStats);
        
        // Prepare response
        const responseData = {
            success: true,
            videoInfo: {
                id: videoInfo.id,
                type: videoInfo.type,
                currentViews: currentStats.views,
                currentLikes: currentStats.likes,
                currentComments: currentStats.comments,
                author: currentStats.author,
                title: currentStats.title
            }
        };

        // Add resolved video ID if available
        if (currentStats.resolvedVideoId) {
            responseData.videoInfo.resolvedVideoId = currentStats.resolvedVideoId;
            responseData.videoInfo.resolved = true;
            responseData.videoInfo.finalVideoId = currentStats.resolvedVideoId;
        } else {
            responseData.videoInfo.finalVideoId = videoInfo.id;
            responseData.videoInfo.resolved = false;
        }
        
        res.json(responseData);
        
    } catch (error) {
        console.log('❌ Video info error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

// ✅ Route 2: Modified Start All Bots with New Logic
// ✅ UPDATED: Start All Bots with Resolved Video ID
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

        // ✅ GET FINAL VIDEO ID (Resolve short URL if needed)
        let finalVideoId = videoInfo.id;
        let finalVideoLink = videoLink;

        if (videoInfo.type === 'SHORT_URL') {
            console.log('🔄 Resolving short URL for bot start...');
            const resolvedVideoId = await resolveShortUrl(videoInfo.shortCode);
            if (resolvedVideoId) {
                finalVideoId = resolvedVideoId;
                // Create proper TikTok URL from resolved ID
                finalVideoLink = `https://www.tiktok.com/@tiktok/video/${resolvedVideoId}`;
                console.log('✅ Using resolved Video ID for bots:', finalVideoId);
            }
        }

        // Calculate target views: currentViews + additional target
        const currentViewsNum = parseInt(currentViews) || 0;
        const targetViewsNum = parseInt(targetViews) || 0;
        const finalTarget = currentViewsNum + targetViewsNum;

        // Store target in global variable for monitoring
        global.runningJobs = global.runningJobs || {};
        global.runningJobs[finalVideoId] = {
            videoId: finalVideoId,
            videoLink: finalVideoLink,
            startViews: currentViewsNum,
            targetViews: finalTarget,
            startTime: new Date(),
            isRunning: true,
            originalLink: videoLink
        };

        const results = [];
        for (const instance of enabledInstances) {
            try {
                // ✅ Send FINAL video ID to bots
                await axios.post(`${instance.url}/start`, {
                    targetViews: finalTarget,
                    videoLink: finalVideoLink,  // Use resolved link
                    mode: 'persistent'
                }, { timeout: 10000 });
                results.push({ instance: instance.id, success: true, message: 'Started' });
            } catch (error) {
                results.push({ instance: instance.id, success: false, message: 'Failed' });
            }
        }

        // Start monitoring for this video
        // Start monitoring for this video WITH AUTO-RESTART
startVideoMonitoring(finalVideoId, finalTarget, videoLink);

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${enabledInstances.length} started`,
            finalTarget: finalTarget,
            finalVideoId: finalVideoId,
            results: results
        });
    } catch (error) {
        console.log('Start bots error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Route 3: Monitoring Status
// ✅ UPDATED: Monitoring Status with Restart Info
app.get('/api/monitoring-status', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.query;
        
        if (!global.runningJobs || !global.runningJobs[videoId]) {
            return res.json({ success: false, isRunning: false });
        }

        const job = global.runningJobs[videoId];
        
        // Get current REAL views
        const currentStats = await getTikTokVideoStats({ id: videoId, type: 'MONITORING' });
        const currentViews = currentStats.views;

        res.json({
            success: true,
            isRunning: job.isRunning,
            startViews: job.startViews,
            targetViews: job.targetViews,
            currentViews: currentViews,
            progress: currentViews - job.startViews,
            remaining: job.targetViews - currentViews,
            startTime: job.startTime,
            restartCount: job.restartCount || 0,
            status: job.status || 'RUNNING',
            lastRestart: job.lastRestart || null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Protected APIs - Instances auth server se fetch karo
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

app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/stop`, {}, { 
                    timeout: 10000,
                    transformResponse: [function (data) {
                        try {
                            return JSON.parse(data);
                        } catch (e) {
                            return { success: true }; // Consider successful even on parse error
                        }
                    }]
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

app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const allStatus = [];

        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, { 
                    timeout: 10000,
                    transformResponse: [function (data) {
                        try {
                            return JSON.parse(data);
                        } catch (e) {
                            return null;
                        }
                    }]
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
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/system/permanent-online/status', (req, res) => {
    try {
        const activeBots = Array.from(permanentOnlineBots.values());
        
        res.json({
            success: true,
            system: {
                isActive: !!permanentOnlineInterval,
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

// ✅ HEALTH CHECK - No authentication required
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Main Controller is running',
        timestamp: new Date().toISOString()
    });
});

// Start the permanent online system when server starts
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ Enhanced Error Handling: Enabled`);
    console.log(`📱 Mobile Compatible: Yes`);
    console.log(`🚀 Fixed Logout System: Active`);
    console.log(`🎯 Video Monitoring System: Active`);
    console.log(`📊 Real-time Stats Tracking: Enabled`);
    
    // ✅ START PERMANENT ONLINE SYSTEM ON BOOT
    setTimeout(() => {
        startPermanentOnlineSystem();
    }, 10000); // Start 10 seconds after server boot
});
