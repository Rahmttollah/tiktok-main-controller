const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 14871;

// ✅ RENDER COMPATIBLE - Dynamic Auth Server URL
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://85.215.137.163:14816';

// ✅ RENDER MIDDLEWARE
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public', {
  maxAge: '1d',
  etag: false
}));

// ✅ RENDER HEALTH CHECK MIDDLEWARE
app.use((req, res, next) => {
  res.set('X-Powered-By', 'TikTok Multi Bot');
  next();
});

// Global variables for monitoring
global.runningJobs = {};
const progressTracker = new Map();
let permanentOnlineBots = new Map();
let backgroundVerificationActive = false;
let permanentOnlineInterval = null;

// ✅ ORDER TRACKING SYSTEM
const orderTracker = new Map();

// ✅ ORDER STATUS CHECK
app.get('/api/order-status/:orderId', verifyToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        
        if (!orderTracker.has(orderId)) {
            return res.json({ 
                success: false, 
                message: 'Order not found',
                status: 'unknown'
            });
        }

        const order = orderTracker.get(orderId);
        
        // Simulate progress updates
        if (order.status === 'processing') {
            const elapsed = Date.now() - order.startTime;
            const progress = Math.min(100, (elapsed / order.estimatedTime) * 100);
            order.progress = progress;
            
            if (progress >= 100) {
                order.status = 'completed';
                order.completedAt = new Date();
            }
        }

        res.json({
            success: true,
            order: order,
            status: order.status,
            progress: order.progress,
            timeRemaining: order.estimatedTime - (Date.now() - order.startTime)
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Status check failed' 
        });
    }
});

// ✅ ENHANCED ZEFAME ORDER WITH TRACKING
// ✅ REAL API ORDER SYSTEM
// ✅ REAL ZEFAME API INTEGRATION (Python Code Ke According)
app.post('/api/zefame/order-tracked', verifyToken, async (req, res) => {
    try {
        const { serviceId, videoLink, quantity = 1, serviceName } = req.body;
        
        console.log('🔄 Calling REAL Zefame API...');
        console.log('📝 Service ID:', serviceId);
        console.log('📝 Video Link:', videoLink);

        if (!serviceId || !videoLink) {
            return res.json({ 
                success: false, 
                message: 'Service ID and video link required'
            });
        }

        // ✅ STEP 1: GET VIDEO ID (Python code ke hisaab)
        console.log('🔍 Getting Video ID...');
        const videoIdResponse = await axios.post('https://zefame-free.com/api_free.php', 
            `action=checkVideoId&link=${encodeURIComponent(videoLink)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            }
        );

        const videoIdData = videoIdResponse.data;
        const videoId = videoIdData?.data?.videoId;
        console.log('🎯 Video ID:', videoId);

        if (!videoId) {
            return res.json({ 
                success: false, 
                message: 'Invalid TikTok link - Could not get Video ID'
            });
        }

        // ✅ STEP 2: PLACE ORDER (Python code ke hisaab)
        console.log('📤 Placing order...');
        const orderData = new URLSearchParams();
        orderData.append('action', 'order');
        orderData.append('service', serviceId.toString());
        orderData.append('link', videoLink);
        orderData.append('uuid', require('crypto').randomUUID());
        orderData.append('videoId', videoId);

        const orderResponse = await axios.post('https://zefame-free.com/api_free.php', orderData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const orderResult = orderResponse.data;
        console.log('📥 Zefame API Response:', orderResult);

        // ✅ STEP 3: PROCESS RESPONSE (Python code ke hisaab)
        let finalResponse = {
            success: false,
            message: 'Unknown response from API',
            data: orderResult
        };

        // Check for success
        if (orderResult.success === true) {
            finalResponse.success = true;
            finalResponse.message = 'Order placed successfully!';
        }
        // Check for time limit/wait time
        else if (orderResult.data && orderResult.data.nextAvailable) {
            const waitTime = orderResult.data.nextAvailable;
            finalResponse.message = `Time limit reached. Next available in ${waitTime} seconds`;
            finalResponse.waitTime = parseInt(waitTime) * 1000; // Convert to milliseconds
            finalResponse.type = 'time_limit';
        }
        // Check for error message
        else if (orderResult.message) {
            finalResponse.message = orderResult.message;
        }

        console.log('📤 Final Response:', finalResponse);
        res.json(finalResponse);
        
    } catch (error) {
        console.log('❌ API Error:', error.message);
        
        let errorMessage = 'API Error: ' + error.message;
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Zefame API is down. Please try again later.';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = 'API request timeout. Please try again.';
        }

        res.json({ 
            success: false, 
            message: errorMessage
        });
    }
});

// ✅ ORDER PROCESSING ENGINE
async function processZefameOrder(orderId, orderData) {
    const order = orderTracker.get(orderId);
    if (!order) return;

    console.log(`🔄 Processing order ${orderId} for ${order.quantity} items`);

    for (let i = 0; i < order.quantity; i++) {
        try {
            order.attempts++;
            order.currentAttempt = i + 1;
            order.progress = ((i + 1) / order.quantity) * 100;

            console.log(`📦 Processing item ${i + 1}/${order.quantity}`);

            // Simulate API call to Zefame
            const orderResult = await placeSingleZefameOrder(
                order.serviceId, 
                order.videoLink,
                order.videoId
            );

            order.results.push({
                attempt: i + 1,
                success: orderResult.success,
                message: orderResult.message,
                timestamp: new Date()
            });

            // Update order status based on result
            if (orderResult.success) {
                order.successCount = (order.successCount || 0) + 1;
            } else {
                order.failedCount = (order.failedCount || 0) + 1;
                
                // Check for time limit error
                if (orderResult.message && orderResult.message.includes('time') && orderResult.message.includes('limit')) {
                    order.status = 'time_limit';
                    order.timeLimitReached = true;
                    break; // Stop processing
                }
            }

            // Update tracker
            orderTracker.set(orderId, order);

            // Delay between requests
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.log(`❌ Order ${orderId} item ${i + 1} failed:`, error.message);
            order.results.push({
                attempt: i + 1,
                success: false,
                message: error.message,
                timestamp: new Date()
            });
            order.failedCount = (order.failedCount || 0) + 1;
        }
    }

    // Finalize order
    order.status = order.timeLimitReached ? 'time_limit' : 'completed';
    order.completedAt = new Date();
    order.progress = 100;
    
    console.log(`✅ Order ${orderId} completed: ${order.successCount || 0} success, ${order.failedCount || 0} failed`);
    orderTracker.set(orderId, order);
}

// ✅ SINGLE ORDER PLACEMENT
async function placeSingleZefameOrder(serviceId, videoLink, videoId) {
    try {
        const orderData = new URLSearchParams();
        orderData.append('action', 'order');
        orderData.append('service', serviceId.toString());
        orderData.append('link', videoLink);
        orderData.append('uuid', require('crypto').randomUUID());
        orderData.append('videoId', videoId);

        const orderResponse = await axios.post('https://zefame-free.com/api_free.php', orderData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        let orderResult;
        
        if (typeof orderResponse.data === 'string') {
            try {
                orderResult = JSON.parse(orderResponse.data);
            } catch {
                orderResult = { success: orderResponse.status === 200 };
            }
        } else {
            orderResult = orderResponse.data;
        }

        return {
            success: orderResult.success || false,
            message: orderResult.message || 'Order processed',
            raw: orderResult
        };

    } catch (error) {
        return {
            success: false,
            message: error.message,
            error: true
        };
    }
}

// ✅ GET ALL ACTIVE ORDERS
app.get('/api/active-orders', verifyToken, async (req, res) => {
    try {
        const activeOrders = Array.from(orderTracker.values())
            .filter(order => order.status === 'processing')
            .map(order => ({
                orderId: order.orderId,
                serviceName: order.serviceName,
                progress: order.progress,
                status: order.status,
                quantity: order.quantity,
                attempts: order.attempts,
                startTime: order.startTime
            }));

        res.json({
            success: true,
            activeOrders: activeOrders,
            total: activeOrders.length
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch orders' 
        });
    }
});

// ✅ ENHANCED TOKEN VERIFICATION
async function verifyToken(req, res, next) {
    try {
        if (req.path === '/api/health' || req.path === '/') {
            return next();
        }

        const token = req.query.token || req.body.token;
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'Token required' });
        }

        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        }, { 
            timeout: 10000,
            headers: {
                'User-Agent': 'TikTok-Bot-Controller/3.0.0'
            }
        });

        if (response.data.success && response.data.valid) {
            req.user = { 
                username: response.data.username,
                role: response.data.role 
            };
            next();
        } else {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
    } catch (error) {
        if (req.path === '/api/health' || req.path.includes('/public')) {
            return next();
        }
        return res.status(401).json({ success: false, message: 'Token verification failed' });
    }
}

// ✅ GET INSTANCES FROM AUTH SERVER
async function getInstancesFromAuthServer(token) {
    try {
        const response = await axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=${token}`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'TikTok-Bot-Controller/3.0.0',
                'Accept': 'application/json'
            }
        });
        
        if (response.data.success) {
            return response.data.instances || [];
        }
        return [];
    } catch (error) {
        console.log('Error fetching instances from auth server:', error.message);
        return [];
    }
}

// ✅ PERMANENT ONLINE SYSTEM
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
    }, 10000);
    
    console.log('✅ Permanent Online System Started');
}

function stopPermanentOnlineSystem() {
    if (permanentOnlineInterval) {
        clearInterval(permanentOnlineInterval);
        permanentOnlineInterval = null;
    }
    permanentOnlineBots.clear();
    console.log('🛑 Permanent Online System Stopped');
}

async function keepAllBotsPermanentlyOnline() {
    try {
        const instances = await getInstancesForSystem();
        
        if (instances.length === 0) {
            return;
        }
        
        let onlineCount = 0;
        let restartedCount = 0;
        
        for (const instance of instances) {
            try {
                const statusResponse = await axios.get(`${instance.url}/status`, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                    }
                });
                
                const botStatus = statusResponse.data;
                
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
                
                if (!botStatus.running && instance.enabled) {
                    console.log(`🔄 Auto-starting idle bot: ${instance.url}`);
                    
                    try {
                        await axios.post(`${instance.url}/start`, {
                            targetViews: 1000000,
                            videoLink: 'https://www.tiktok.com/@tiktok/video/7106688751857945857',
                            mode: 'permanent'
                        }, { 
                            timeout: 20000,
                            headers: {
                                'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                            }
                        });
                        
                        botInfo.restartCount++;
                        restartedCount++;
                    } catch (startError) {
                        console.log(`❌ Failed to auto-start bot ${instance.url}:`, startError.message);
                    }
                }
                
            } catch (error) {
                console.log(`🔴 Bot ${instance.url} is OFFLINE - Attempting restart...`);
                
                try {
                    const botInfo = permanentOnlineBots.get(instance.id) || {
                        instanceId: instance.id,
                        instanceUrl: instance.url,
                        firstSeen: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        restartCount: 0,
                        alwaysOnline: true
                    };
                    
                    await axios.post(`${instance.url}/start`, {
                        targetViews: 1000000,
                        videoLink: 'https://www.tiktok.com/@tiktok/video/7106688751857945857',
                        mode: 'permanent_recovery'
                    }, { 
                        timeout: 25000,
                        headers: {
                            'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                        }
                    });
                    
                    botInfo.restartCount++;
                    botInfo.lastSeen = new Date().toISOString();
                    permanentOnlineBots.set(instance.id, botInfo);
                    
                    restartedCount++;
                    
                } catch (restartError) {
                    console.log(`💀 CRITICAL: Bot ${instance.url} cannot be restarted:`, restartError.message);
                    
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
        
    } catch (error) {
        console.log('❌ Permanent online system critical error:', error.message);
    }
}

async function getInstancesForSystem() {
    try {
        const response = await axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=system_admin_2024`, {
            timeout: 20000,
            headers: {
                'User-Agent': 'TikTok-Bot-Controller/3.0.0',
                'Accept': 'application/json'
            }
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

// ✅ VIDEO INFO EXTRACTION
function extractVideoInfo(url) {
    let cleanUrl = url.split('?')[0].trim();
    
    const standardMatch = cleanUrl.match(/tiktok\.com\/@[^\/]+\/video\/(\d{19})/);
    if (standardMatch) {
        return { id: standardMatch[1], type: 'STANDARD' };
    }
    
    const shortUrlMatch = cleanUrl.match(/(vm|vt)\.tiktok\.com\/([A-Za-z0-9]+)/);
    if (shortUrlMatch) {
        return { 
            id: shortUrlMatch[2], 
            type: 'SHORT_URL',
            shortCode: shortUrlMatch[2],
            originalUrl: cleanUrl
        };
    }
    
    const videoIdMatch = cleanUrl.match(/\/(\d{19})(\/|$)/);
    if (videoIdMatch) {
        return { id: videoIdMatch[1], type: 'VIDEO_ID_ONLY' };
    }
    
    return { id: null, type: 'UNKNOWN' };
}

function resolveShortUrl(shortCode) {
    return new Promise((resolve) => {
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
            const finalUrl = res.headers.location;
            
            if (finalUrl) {
                const videoIdMatch = finalUrl.match(/\/(\d{19})/);
                if (videoIdMatch) {
                    resolve(videoIdMatch[1]);
                } else {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
            
            res.on('data', () => {});
            res.on('end', () => {});
        });

        req.on('error', (error) => {
            resolve(null);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            resolve(null);
        });
        
        req.end();
    });
}

function getTikTokVideoStats(videoInfo) {
    return new Promise((resolve) => {
        if (videoInfo.type === 'SHORT_URL') {
            resolveShortUrl(videoInfo.shortCode)
                .then(resolvedVideoId => {
                    if (resolvedVideoId) {
                        getTikTokVideoStatsDirect(resolvedVideoId)
                            .then(stats => {
                                stats.resolvedVideoId = resolvedVideoId;
                                stats.originalShortCode = videoInfo.shortCode;
                                stats.resolved = true;
                                resolve(stats);
                            })
                            .catch((error) => {
                                resolve(getFallbackStats());
                            });
                    } else {
                        resolve(getFallbackStats());
                    }
                })
                .catch((error) => {
                    resolve(getFallbackStats());
                });
            return;
        }

        getTikTokVideoStatsDirect(videoInfo.id)
            .then(stats => {
                stats.resolved = true;
                stats.resolvedVideoId = videoInfo.id;
                resolve(stats);
            })
            .catch((error) => {
                resolve(getFallbackStats());
            });
    });
}

function getTikTokVideoStatsDirect(videoId) {
    return new Promise((resolve, reject) => {
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
                try {
                    const stats = extractStatsFromHTML(data);
                    resolve(stats);
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

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

    try {
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (jsonLdMatch) {
            try {
                const jsonData = JSON.parse(jsonLdMatch[1]);
                
                if (jsonData.interactionStatistic) {
                    stats.views = parseInt(jsonData.interactionStatistic.userInteractionCount) || 0;
                }
                if (jsonData.name && jsonData.name !== 'Company') {
                    stats.title = jsonData.name;
                }
                if (jsonData.author && jsonData.author.name) {
                    stats.author = jsonData.author.name;
                }
            } catch (e) {}
        }

        const viewMatch = html.match(/"playCount":(\d+)/) || html.match(/"viewCount":(\d+)/);
        if (viewMatch) {
            stats.views = parseInt(viewMatch[1]) || 0;
        }

        const likeMatch = html.match(/"diggCount":(\d+)/) || html.match(/"likeCount":(\d+)/);
        if (likeMatch) {
            stats.likes = parseInt(likeMatch[1]) || 0;
        }

        const commentMatch = html.match(/"commentCount":(\d+)/);
        if (commentMatch) {
            stats.comments = parseInt(commentMatch[1]) || 0;
        }

        const authorMatch = html.match(/"author":"([^"]*)"/) || html.match(/"uniqueId":"([^"]*)"/);
        if (authorMatch) {
            stats.author = authorMatch[1] || 'Unknown';
        }

        const titleMatch = html.match(/"title":"([^"]*)"/) || html.match(/"description":"([^"]*)"/);
        if (titleMatch && titleMatch[1] !== 'Company') {
            stats.title = titleMatch[1] || 'No Title';
        }

        const videoIdMatch = html.match(/"videoId":"(\d+)"/);
        if (videoIdMatch) {
            stats.resolvedVideoId = videoIdMatch[1];
        }

    } catch (error) {}

    return stats;
}

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

// ✅ ZEFAME SERVICES INTEGRATION
// ✅ FIXED ZEFAME SERVICES ROUTE
// ✅ CORRECT ZEFAME ROUTES - Add these to your existing routes

// ✅ FIXED: Zefame Services Route
// ✅ REPLACE WITH ACTUAL ZEFAME API ROUTES

// Zefame Test Connection
app.get('/api/zefame/test', verifyToken, async (req, res) => {
    try {
        console.log('🔍 Testing Zefame API connection...');
        
        const response = await axios.get('https://zefame-free.com/api_free.php?action=config', {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        console.log('✅ Zefame API response status:', response.status);
        
        res.json({
            success: true,
            status: response.status,
            data: response.data,
            message: 'Zefame API is working'
        });
    } catch (error) {
        console.log('❌ Zefame API test failed:', error.message);
        res.json({
            success: false,
            error: error.message,
            message: 'Zefame API connection failed'
        });
    }
});

// Actual Zefame Services
app.get('/api/zefame/services', verifyToken, async (req, res) => {
    try {
        console.log('🔄 Fetching actual Zefame services...');
        
        // Direct call to Zefame API
        const response = await axios.get('https://zefame-free.com/api_free.php?action=config', {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        console.log('📦 Zefame raw response received');

        let servicesData = response.data;
        
        // Parse response if it's string
        if (typeof servicesData === 'string') {
            try {
                servicesData = JSON.parse(servicesData);
            } catch (parseError) {
                console.log('❌ JSON parse error:', parseError.message);
                return res.json({
                    success: false,
                    message: 'Invalid JSON from Zefame API'
                });
            }
        }

        console.log('🔍 Zefame response structure:', Object.keys(servicesData));

        // Extract services from Zefame response
        let services = [];
        
        // Zefame API structure
        if (servicesData.data && servicesData.data.tiktok && servicesData.data.tiktok.services) {
            services = servicesData.data.tiktok.services;
            console.log('✅ Found services in data.tiktok.services');
        } 
        else if (servicesData.tiktok && servicesData.tiktok.services) {
            services = servicesData.tiktok.services;
            console.log('✅ Found services in tiktok.services');
        }
        else if (Array.isArray(servicesData)) {
            services = servicesData;
            console.log('✅ Found services as direct array');
        }
        else {
            console.log('❌ No services found in expected structure');
            // Try to find services anywhere in response
            services = findAllServices(servicesData);
        }

        if (services.length === 0) {
            console.log('❌ No services extracted from Zefame response');
            return res.json({
                success: false,
                message: 'No services found in Zefame API response'
            });
        }

        console.log(`✅ Extracted ${services.length} services from Zefame`);

        // Map services to our format
        const serviceMap = {
            229: "TikTok Views",
            228: "TikTok Followers", 
            232: "TikTok Free Likes",
            235: "TikTok Free Shares",
            236: "TikTok Free Favorites"
        };

        const formattedServices = services.map(service => {
            const serviceId = service.id || service.service_id;
            return {
                id: serviceId,
                name: serviceMap[serviceId] || service.name || `Service ${serviceId}`,
                available: service.available !== undefined ? service.available : true,
                description: service.description || service.rate || '',
                rate: service.description ? 
                     service.description.replace('vues', 'views')
                        .replace('partages', 'shares')
                        .replace('favoris', 'favorites') 
                     : (service.rate || 'Free Service')
            };
        }).filter(service => service.id); // Remove invalid services

        console.log('🎯 Final formatted services:', formattedServices.length);

        res.json({ 
            success: true, 
            services: formattedServices,
            total: formattedServices.length,
            source: 'Zefame API'
        });
        
    } catch (error) {
        console.log('❌ Zefame services error:', error.message);
        
        res.json({ 
            success: false, 
            message: 'Zefame API error: ' + error.message
        });
    }
});

// Helper function to find services in any structure
function findAllServices(obj, path = '') {
    const services = [];
    
    if (!obj || typeof obj !== 'object') {
        return services;
    }
    
    // Check if current object is a service
    if ((obj.id !== undefined || obj.service_id !== undefined) && 
        (obj.name !== undefined || obj.description !== undefined)) {
        services.push(obj);
    }
    
    // Recursively search in all properties
    for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (Array.isArray(obj[key])) {
                obj[key].forEach(item => {
                    services.push(...findAllServices(item, path + '.' + key));
                });
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                services.push(...findAllServices(obj[key], path + '.' + key));
            }
        }
    }
    
    return services;
}

// Actual Zefame Order Placement
app.post('/api/zefame/order', verifyToken, async (req, res) => {
    try {
        const { serviceId, videoLink, quantity = 1 } = req.body;
        
        console.log(`🔄 Placing actual Zefame order: Service ${serviceId}, Quantity ${quantity}`);
        
        if (!serviceId || !videoLink) {
            return res.json({ success: false, message: 'Service ID and video link required' });
        }

        const videoInfo = extractVideoInfo(videoLink);
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        const orders = [];
        let successCount = 0;

        for (let i = 0; i < quantity; i++) {
            try {
                const orderData = new URLSearchParams();
                orderData.append('action', 'order');
                orderData.append('service', serviceId.toString());
                orderData.append('link', videoLink);
                orderData.append('uuid', require('crypto').randomUUID());
                orderData.append('videoId', videoInfo.id);

                console.log(`📤 Sending order ${i+1} to Zefame...`);

                const orderResponse = await axios.post('https://zefame-free.com/api_free.php', orderData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 20000
                });

                console.log(`✅ Order ${i+1} response:`, orderResponse.status);

                let orderResult;
                
                // Parse response
                if (typeof orderResponse.data === 'string') {
                    try {
                        orderResult = JSON.parse(orderResponse.data);
                    } catch {
                        orderResult = { 
                            success: orderResponse.status === 200, 
                            raw: orderResponse.data 
                        };
                    }
                } else {
                    orderResult = orderResponse.data;
                }

                orders.push(orderResult);
                
                if (orderResult.success) {
                    successCount++;
                    console.log(`✅ Order ${i+1} successful`);
                } else {
                    console.log(`❌ Order ${i+1} failed:`, orderResult);
                }

                // Respect rate limiting
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (orderError) {
                console.log(`❌ Order ${i+1} error:`, orderError.message);
                orders.push({ 
                    success: false, 
                    error: orderError.message,
                    attempt: i + 1
                });
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        res.json({ 
            success: successCount > 0,
            message: `Placed ${successCount}/${quantity} orders via Zefame API`,
            orders: orders,
            summary: {
                requested: quantity,
                successful: successCount,
                failed: quantity - successCount
            }
        });
        
    } catch (error) {
        console.log('❌ Zefame order error:', error.message);
        res.json({ 
            success: false, 
            message: 'Zefame order failed: ' + error.message 
        });
    }
});

// ✅ PROGRESS TRACKING SYSTEM
function startEnhancedMonitoring(jobId, videoId, targetViews) {
    const monitoringInterval = setInterval(async () => {
        try {
            const job = progressTracker.get(jobId);
            if (!job || !job.isRunning) {
                clearInterval(monitoringInterval);
                return;
            }

            await updateInstanceStatuses(jobId);
            
            const currentStats = await getTikTokVideoStats({ id: videoId, type: 'STANDARD' });
            job.currentViews = currentStats.views;
            job.lastUpdate = new Date();
            job.checkCount++;

            progressTracker.set(jobId, job);

            if (currentStats.views >= targetViews) {
                job.isRunning = false;
                progressTracker.set(jobId, job);
                clearInterval(monitoringInterval);
                stopJobBots(jobId);
            }

        } catch (error) {
            console.log('Monitoring error:', error.message);
        }
    }, 2000);
}

async function updateInstanceStatuses(jobId) {
    const job = progressTracker.get(jobId);
    if (!job) return;

    for (let instance of job.instances) {
        if (instance.status === 'running') {
            try {
                const response = await axios.get(`${instance.url}/status`, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                    }
                });
                
                const status = response.data;
                instance.success = status.success || 0;
                instance.requests = status.reqs || 0;
                instance.rps = status.rps || 0;
                instance.status = status.running ? 'running' : 'stopped';
                
            } catch (error) {
                instance.status = 'offline';
            }
        }
    }

    job.totalSuccess = job.instances.reduce((sum, inst) => sum + inst.success, 0);
    job.totalRequests = job.instances.reduce((sum, inst) => sum + inst.requests, 0);
    
    progressTracker.set(jobId, job);
}

async function stopJobBots(jobId) {
    const job = progressTracker.get(jobId);
    if (!job) return;

    for (let instance of job.instances) {
        if (instance.status === 'running') {
            try {
                await axios.post(`${instance.url}/stop`, {}, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                    }
                });
                instance.status = 'stopped';
            } catch (error) {
                console.log(`Failed to stop instance ${instance.id}:`, error.message);
            }
        }
    }
    
    job.isRunning = false;
    progressTracker.set(jobId, job);
}

// ✅ ACTUAL STATUS CHECK
app.get('/api/actual-status', verifyToken, async (req, res) => {
    try {
        const instances = await getInstancesFromAuthServer(req.query.token);
        const runningInstances = [];
        
        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, {
                    timeout: 5000
                });
                if (response.data.running) {
                    runningInstances.push({
                        id: instance.id,
                        url: instance.url,
                        status: response.data
                    });
                }
            } catch (error) {}
        }
        
        res.json({
            success: true,
            actuallyRunning: runningInstances.length > 0,
            runningInstances: runningInstances,
            totalChecked: instances.length
        });
        
    } catch (error) {
        res.json({
            success: false,
            actuallyRunning: false,
            error: error.message
        });
    }
});

// ✅ LIVE PROGRESS ENDPOINT
app.get('/api/live-progress', verifyToken, async (req, res) => {
    try {
        const { jobId } = req.query;
        
        if (!jobId || !progressTracker.has(jobId)) {
            return res.json({ 
                success: false, 
                isRunning: false,
                message: 'No active job found'
            });
        }

        const job = progressTracker.get(jobId);
        
        await updateInstanceStatuses(jobId);
        const updatedJob = progressTracker.get(jobId);

        const progress = updatedJob.currentViews - updatedJob.startViews;
        const remaining = updatedJob.targetViews - updatedJob.currentViews;
        const percentage = Math.min(100, ((progress / updatedJob.userTarget) * 100));
        
        const timeElapsed = (new Date() - updatedJob.startTime) / 1000;
        const viewsPerMinute = timeElapsed > 0 ? (progress / timeElapsed) * 60 : 0;
        const estimatedTime = viewsPerMinute > 0 ? (remaining / viewsPerMinute) : 0;

        res.json({
            success: true,
            isRunning: updatedJob.isRunning,
            jobId: updatedJob.jobId,
            videoInfo: {
                id: updatedJob.videoId,
                startViews: updatedJob.startViews,
                currentViews: updatedJob.currentViews,
                targetViews: updatedJob.targetViews
            },
            progress: {
                current: progress,
                target: updatedJob.userTarget,
                remaining: remaining,
                percentage: percentage.toFixed(1),
                viewsPerMinute: Math.round(viewsPerMinute),
                estimatedMinutes: Math.round(estimatedTime)
            },
            instances: updatedJob.instances.map(inst => ({
                id: inst.id,
                status: inst.status,
                success: inst.success,
                requests: inst.requests,
                rps: inst.rps
            })),
            totals: {
                success: updatedJob.totalSuccess,
                requests: updatedJob.totalRequests,
                activeBots: updatedJob.instances.filter(inst => inst.status === 'running').length,
                totalBots: updatedJob.instances.length
            },
            timing: {
                startTime: updatedJob.startTime,
                lastUpdate: updatedJob.lastUpdate,
                checkCount: updatedJob.checkCount
            }
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Progress tracking error: ' + error.message 
        });
    }
});

// ✅ ROUTES
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'TikTok Main Controller'
    });
});

app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.get('/dashboard', async (req, res) => {
    const token = req.query.token;
    
    if (!token) {
        return res.redirect(AUTH_SERVER_URL);
    }
    
    try {
        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        }, {
            timeout: 10000,
            headers: {
                'User-Agent': 'TikTok-Bot-Controller/3.0.0'
            }
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

app.post('/api/logout', async (req, res) => {
    try {
        const token = req.body.token;
        
        if (token) {
            axios.post(`${AUTH_SERVER_URL}/api/global-logout`, {
                token: token
            }, { 
                timeout: 5000,
                headers: {
                    'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                }
            }).catch(err => {});
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

app.post('/api/get-video-info', verifyToken, async (req, res) => {
    try {
        const { videoLink, token } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        const videoInfo = extractVideoInfo(videoLink);
        
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link!' });
        }
        
        const currentStats = await getTikTokVideoStats(videoInfo);
        
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
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

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

        let finalVideoId = videoInfo.id;
        let finalVideoLink = videoLink;

        if (videoInfo.type === 'SHORT_URL') {
            const resolvedVideoId = await resolveShortUrl(videoInfo.shortCode);
            if (resolvedVideoId) {
                finalVideoId = resolvedVideoId;
                finalVideoLink = `https://www.tiktok.com/@tiktok/video/${resolvedVideoId}`;
            }
        }

        const currentViewsNum = parseInt(currentViews) || 0;
        const targetViewsNum = parseInt(targetViews) || 0;
        const finalTarget = currentViewsNum + targetViewsNum;

        const jobId = finalVideoId + '_' + Date.now();
        
        progressTracker.set(jobId, {
            jobId: jobId,
            videoId: finalVideoId,
            videoLink: finalVideoLink,
            startViews: currentViewsNum,
            targetViews: finalTarget,
            userTarget: targetViewsNum,
            startTime: new Date(),
            isRunning: true,
            instances: enabledInstances.map(inst => ({
                id: inst.id,
                url: inst.url,
                status: 'starting',
                success: 0,
                requests: 0
            })),
            totalSuccess: 0,
            totalRequests: 0,
            currentViews: currentViewsNum,
            lastUpdate: new Date(),
            checkCount: 0
        });

        const results = [];
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: finalTarget,
                    videoLink: finalVideoLink,
                    mode: 'persistent'
                }, { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                    }
                });
                results.push({ instance: instance.id, success: true, message: 'Started' });
                
                const job = progressTracker.get(jobId);
                const instanceIndex = job.instances.findIndex(inst => inst.id === instance.id);
                if (instanceIndex !== -1) {
                    job.instances[instanceIndex].status = 'running';
                }
                progressTracker.set(jobId, job);
                
            } catch (error) {
                results.push({ instance: instance.id, success: false, message: 'Failed: ' + error.message });
                
                const job = progressTracker.get(jobId);
                const instanceIndex = job.instances.findIndex(inst => inst.id === instance.id);
                if (instanceIndex !== -1) {
                    job.instances[instanceIndex].status = 'failed';
                }
                progressTracker.set(jobId, job);
            }
        }

        startEnhancedMonitoring(jobId, finalVideoId, finalTarget);

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${enabledInstances.length} started`,
            finalTarget: finalTarget,
            finalVideoId: finalVideoId,
            jobId: jobId,
            results: results
        });
        
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        let stoppedCount = 0;
        const stopPromises = [];

        for (const instance of enabledInstances) {
            const stopPromise = axios.post(`${instance.url}/stop`, {}, { 
                timeout: 10000,
                headers: {
                    'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                }
            })
            .then(() => {
                stoppedCount++;
            })
            .catch(error => {
                console.log(`❌ Failed to stop ${instance.url}:`, error.message);
            });
            
            stopPromises.push(stopPromise);
        }

        await Promise.allSettled(stopPromises);
        
        progressTracker.clear();
        global.runningJobs = {};
        
        res.json({ 
            success: true, 
            message: `Stopped ${stoppedCount}/${enabledInstances.length} bots`,
            stopped: stoppedCount,
            total: enabledInstances.length
        });
        
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
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'TikTok-Bot-Controller/3.0.0'
                    }
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

app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Main Controller is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '3.0.0'
    });
});

// ✅ ADD THIS ROUTE TO main-controller.js - EXACT LOCATION:

// ... (tumhara existing code) ...

// ✅ ✅ ✅ YEH ADD KARO - LAST MEIN ✅ ✅ ✅
app.get('/api/zefame/test', verifyToken, async (req, res) => {
    try {
        console.log('🔍 Testing Zefame API connection...');
        
        const response = await axios.get('https://zefame-free.com/api_free.php?action=config', {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        console.log('✅ Zefame API test successful:', response.status);
        
        res.json({
            success: true,
            status: response.status,
            message: 'Zefame API is accessible'
        });
    } catch (error) {
        console.log('❌ Zefame API test failed:', error.message);
        res.json({
            success: false,
            error: error.message,
            message: 'Zefame API is not accessible'
        });
    }
});

// ✅ ✅ ✅ YEH BHI ADD KARO ✅ ✅ ✅
app.get('/api/zefame/services', verifyToken, async (req, res) => {
    try {
        console.log('🔄 Fetching Zefame services...');
        
        const response = await axios.get('https://zefame-free.com/api_free.php?action=config', {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log('✅ Zefame response status:', response.status);

        let servicesData = response.data;
        
        // Parse JSON if string
        if (typeof servicesData === 'string') {
            try {
                servicesData = JSON.parse(servicesData);
            } catch (parseError) {
                return res.json({
                    success: false,
                    message: 'Invalid JSON from Zefame'
                });
            }
        }

        console.log('📦 Zefame response keys:', Object.keys(servicesData));

        // Extract services
        let services = [];
        
        if (servicesData.data && servicesData.data.tiktok && servicesData.data.tiktok.services) {
            services = servicesData.data.tiktok.services;
        } else if (servicesData.tiktok && servicesData.tiktok.services) {
            services = servicesData.tiktok.services;
        } else {
            return res.json({
                success: false,
                message: 'No services found in Zefame response'
            });
        }

        console.log(`✅ Found ${services.length} services`);

        // Map services
        const serviceMap = {
            229: "TikTok Views",
            228: "TikTok Followers", 
            232: "TikTok Free Likes",
            235: "TikTok Free Shares",
            236: "TikTok Free Favorites"
        };

        const formattedServices = services.map(service => ({
            id: service.id,
            name: serviceMap[service.id] || service.name,
            available: service.available !== undefined ? service.available : true,
            description: service.description || '',
            rate: service.description ? service.description.replace('vues', 'views').replace('partages', 'shares').replace('favoris', 'favorites') : 'Free Service'
        }));

        res.json({ 
            success: true, 
            services: formattedServices,
            total: formattedServices.length
        });
        
    } catch (error) {
        console.log('❌ Zefame services error:', error.message);
        res.json({ 
            success: false, 
            message: 'Zefame API error: ' + error.message
        });
    }
});

// ✅ ✅ ✅ YEH BHI ADD KARO ✅ ✅ ✅
app.post('/api/zefame/order', verifyToken, async (req, res) => {
    try {
        const { serviceId, videoLink, quantity = 1 } = req.body;
        
        console.log(`🔄 Placing Zefame order: Service ${serviceId}, Quantity ${quantity}`);
        
        if (!serviceId || !videoLink) {
            return res.json({ success: false, message: 'Service ID and video link required' });
        }

        const videoInfo = extractVideoInfo(videoLink);
        if (!videoInfo.id) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        const orders = [];
        let successCount = 0;

        for (let i = 0; i < quantity; i++) {
            try {
                const orderData = new URLSearchParams();
                orderData.append('action', 'order');
                orderData.append('service', serviceId.toString());
                orderData.append('link', videoLink);
                orderData.append('uuid', require('crypto').randomUUID());
                orderData.append('videoId', videoInfo.id);

                const orderResponse = await axios.post('https://zefame-free.com/api_free.php', orderData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 15000
                });

                let orderResult;
                
                if (typeof orderResponse.data === 'string') {
                    try {
                        orderResult = JSON.parse(orderResponse.data);
                    } catch {
                        orderResult = { success: orderResponse.status === 200 };
                    }
                } else {
                    orderResult = orderResponse.data;
                }

                orders.push(orderResult);
                
                if (orderResult.success) {
                    successCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (orderError) {
                console.log(`❌ Order ${i+1} failed:`, orderError.message);
                orders.push({ success: false, error: orderError.message });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        res.json({ 
            success: successCount > 0,
            message: `Placed ${successCount}/${quantity} orders successfully`,
            orders: orders
        });
        
    } catch (error) {
        console.log('❌ Zefame order error:', error.message);
        res.json({ 
            success: false, 
            message: 'Order failed: ' + error.message 
        });
    }
});

// 🚀 YEH PEHLE SE HONA CHAHIYE - ISSE PEHLE WALA CODE






// ✅ SERVER START
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TikTok Main Controller deployed on Render`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ Render Compatibility: Enabled`);
    
    setTimeout(() => {
        startPermanentOnlineSystem();
        console.log('🔧 Permanent Online System: ACTIVE');
    }, 15000);
});

// ✅ GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received - shutting down gracefully');
    stopPermanentOnlineSystem();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received - shutting down');
    stopPermanentOnlineSystem();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
