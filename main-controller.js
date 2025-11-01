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

// ✅ STRICT Token verification middleware
async function verifyToken(req, res, next) {
    try {
        const token = req.query.token || req.body.token;
        
        if (!token) {
            return res.redirect(AUTH_SERVER_URL);
        }

        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        }, { timeout: 5000 });

        if (response.data.success && response.data.valid) {
            req.user = { 
                username: response.data.username,
                role: response.data.role 
            };
            next();
        } else {
            return res.redirect(AUTH_SERVER_URL);
        }
    } catch (error) {
        return res.redirect(AUTH_SERVER_URL);
    }
}

// ✅ GET USER'S ALLOCATED BOTS FROM AUTH SERVER
async function getUserAllocatedBots(token) {
    try {
        const response = await axios.get(`${AUTH_SERVER_URL}/api/user-bots?token=${token}`, {
            timeout: 5000
        });
        
        if (response.data.success) {
            return response.data.allocatedBots;
        }
        return [];
    } catch (error) {
        console.log('Error fetching user bots from auth server:', error.message);
        return [];
    }
}

// ✅ GET ALL BOTS FROM AUTH SERVER (For admin view)
async function getAllBotsFromAuthServer(token) {
    try {
        const response = await axios.get(`${AUTH_SERVER_URL}/api/admin/bot-instances?token=${token}`, {
            timeout: 5000
        });
        
        if (response.data.success) {
            return response.data.instances;
        }
        return [];
    } catch (error) {
        console.log('Error fetching all bots from auth server:', error.message);
        return [];
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ✅ Logout route
app.post('/api/logout', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        
        await axios.post(`${AUTH_SERVER_URL}/api/logout`, {
            token: token
        }).catch(err => {});
        
        res.json({ 
            success: true, 
            redirectUrl: AUTH_SERVER_URL 
        });
    } catch (error) {
        res.json({ 
            success: true, 
            redirectUrl: AUTH_SERVER_URL 
        });
    }
});

// ✅ Get user's allocated bots
app.get('/api/user-bots', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const allocatedBots = await getUserAllocatedBots(token);
        
        res.json({ 
            success: true, 
            allocatedBots: allocatedBots,
            username: req.user.username,
            role: req.user.role
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Start All Bots - Only user's allocated bots
app.post('/api/start-all', verifyToken, async (req, res) => {
    try {
        const { videoLink, targetViews, token } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        // Get user's allocated bots
        const allocatedBots = await getUserAllocatedBots(token);
        const enabledBots = allocatedBots.filter(bot => bot.enabled);
        
        if (enabledBots.length === 0) {
            return res.json({ success: false, message: 'No allocated bot instances available' });
        }

        const idMatch = videoLink.match(/\d{18,19}/g);
        if (!idMatch) {
            return res.json({ success: false, message: 'Invalid TikTok link' });
        }

        const results = [];
        for (const bot of enabledBots) {
            try {
                await axios.post(`${bot.url}/start`, {
                    targetViews: parseInt(targetViews) || 1000,
                    videoLink: videoLink,
                    mode: 'target'
                }, { timeout: 10000 });
                results.push({ instance: bot.id, success: true, message: 'Started' });
            } catch (error) {
                results.push({ instance: bot.id, success: false, message: 'Failed' });
            }
        }

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${enabledBots.length} allocated bots started`,
            results: results
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Stop All Bots - Only user's allocated bots
app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const allocatedBots = await getUserAllocatedBots(token);
        const enabledBots = allocatedBots.filter(bot => bot.enabled);
        
        for (const bot of enabledBots) {
            try {
                await axios.post(`${bot.url}/stop`, {}, { timeout: 10000 });
            } catch (error) {
                // Continue even if some bots fail to stop
            }
        }
        
        res.json({ success: true, message: 'All allocated bot instances stopped' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Status All Bots - Only user's allocated bots + Global view for admin
app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        
        let botsToCheck = [];
        
        // If user is admin, show all bots, else show only allocated bots
        if (req.user.role === 'admin' || req.user.role === 'subadmin') {
            botsToCheck = await getAllBotsFromAuthServer(token);
        } else {
            botsToCheck = await getUserAllocatedBots(token);
        }
        
        const allStatus = [];

        for (const bot of botsToCheck) {
            try {
                const response = await axios.get(`${bot.url}/status`, { timeout: 10000 });
                allStatus.push({ 
                    id: bot.id,
                    name: `Bot ${bot.id.substring(0, 8)}`,
                    url: bot.url,
                    allocatedTo: bot.allocatedTo,
                    enabled: bot.enabled, 
                    status: response.data, 
                    online: true 
                });
            } catch (error) {
                allStatus.push({ 
                    id: bot.id,
                    name: `Bot ${bot.id.substring(0, 8)}`, 
                    url: bot.url,
                    allocatedTo: bot.allocatedTo,
                    enabled: bot.enabled, 
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
            totalBots: botsToCheck.filter(bot => bot.enabled).length
        };
        
        totals.successRate = totals.reqs > 0 ? ((totals.success / totals.reqs) * 100).toFixed(1) + '%' : '0%';

        res.json({
            success: true,
            instances: allStatus,
            totals: totals,
            userRole: req.user.role,
            username: req.user.username
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ User info endpoint
app.get('/api/user-info', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        
        // Get user info from auth server
        const response = await axios.get(`${AUTH_SERVER_URL}/api/auth-dashboard`, {
            headers: { 'Cookie': `token=${token}` }
        }).catch(err => null);
        
        if (response && response.data.success) {
            res.json({
                success: true,
                user: response.data.user,
                allocatedBots: response.data.userBots
            });
        } else {
            res.json({
                success: true,
                user: {
                    username: req.user.username,
                    role: req.user.role
                },
                allocatedBots: []
            });
        }
    } catch (error) {
        res.json({
            success: true,
            user: {
                username: req.user.username,
                role: req.user.role
            },
            allocatedBots: []
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ User-specific bot allocation: Enabled`);
    console.log(`🎯 Role-based access: Implemented`);
});
