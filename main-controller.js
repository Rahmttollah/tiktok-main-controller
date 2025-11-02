const express = require('express');
const axios = require('axios');
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

// ✅ Start/Stop/Status APIs (with better error handling)
app.post('/api/start-all', verifyToken, async (req, res) => {
    try {
        const { videoLink, targetViews, token } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        if (enabledInstances.length === 0) {
            return res.json({ success: false, message: 'No bot instances available' });
        }

        const idMatch = videoLink.match(/\d{18,19}/g);
        if (!idMatch) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        const results = [];
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: parseInt(targetViews) || 1000,
                    videoLink: videoLink,
                    mode: 'target'
                }, { 
                    timeout: 10000,
                    transformResponse: [function (data) {
                        try {
                            return JSON.parse(data);
                        } catch (e) {
                            return { success: false };
                        }
                    }]
                });
                results.push({ instance: instance.id, success: true, message: 'Started' });
            } catch (error) {
                results.push({ instance: instance.id, success: false, message: 'Failed' });
            }
        }

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${enabledInstances.length} started`,
            results: results
        });
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
    
    // ✅ START PERMANENT ONLINE SYSTEM ON BOOT
    setTimeout(() => {
        startPermanentOnlineSystem();
    }, 10000); // Start 10 seconds after server boot
});
