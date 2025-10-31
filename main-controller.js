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

// ✅ USER SESSIONS STORAGE - Har user ka alag data
const userSessionsFile = path.join(__dirname, 'user-sessions.json');

function readUserSessions() {
    try {
        if (fs.existsSync(userSessionsFile)) {
            return JSON.parse(fs.readFileSync(userSessionsFile, 'utf8'));
        }
    } catch (error) {
        console.log('Error reading user sessions:', error);
    }
    return {};
}

function writeUserSessions(sessions) {
    try {
        fs.writeFileSync(userSessionsFile, JSON.stringify(sessions, null, 2));
        return true;
    } catch (error) {
        console.log('Error writing user sessions:', error);
        return false;
    }
}

// ✅ GET INSTANCES FROM AUTH SERVER
async function getInstancesFromAuthServer(token) {
    try {
        const response = await axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=${token}`, {
            timeout: 5000
        });
        
        if (response.data.success) {
            return response.data.instances;
        }
        return [];
    } catch (error) {
        console.log('Error fetching instances from auth server:', error.message);
        return [];
    }
}

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
                token: token
            };
            next();
        } else {
            return res.redirect(AUTH_SERVER_URL);
        }
    } catch (error) {
        return res.redirect(AUTH_SERVER_URL);
    }
}

// ✅ GET USER SPECIFIC DATA
function getUserSessionData(username) {
    const sessions = readUserSessions();
    if (!sessions[username]) {
        sessions[username] = {
            username: username,
            currentVideo: null,
            targetViews: 0,
            isRunning: false,
            success: 0,
            fails: 0,
            reqs: 0,
            startTime: null,
            lastUpdated: new Date().toISOString()
        };
        writeUserSessions(sessions);
    }
    return sessions[username];
}

function updateUserSessionData(username, data) {
    const sessions = readUserSessions();
    if (sessions[username]) {
        sessions[username] = { ...sessions[username], ...data, lastUpdated: new Date().toISOString() };
        writeUserSessions(sessions);
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ✅ GET USER INFO API - Username fetch karega
app.get('/api/user-info', verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const token = req.user.token;
        
        res.json({
            success: true,
            user: {
                username: username,
                token: token
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ FIXED LOGOUT ROUTE
app.post('/api/logout', verifyToken, async (req, res) => {
    try {
        const token = req.user.token;
        const username = req.user.username;
        
        // ✅ User session clear karo
        const sessions = readUserSessions();
        if (sessions[username]) {
            sessions[username].isRunning = false;
            writeUserSessions(sessions);
        }
        
        // ✅ Auth server ko logout notify karo
        await axios.post(`${AUTH_SERVER_URL}/api/logout`, {
            token: token
        }).catch(err => {
            console.log('Auth server logout notification failed:', err.message);
        });
        
        // ✅ Direct auth server ke login page pe redirect
        res.json({ 
            success: true, 
            message: 'Logout successful',
            redirectUrl: AUTH_SERVER_URL
        });
    } catch (error) {
        res.json({ 
            success: true, 
            redirectUrl: AUTH_SERVER_URL 
        });
    }
});

// ✅ Protected APIs - User specific data
app.get('/api/instances', verifyToken, async (req, res) => {
    try {
        const token = req.user.token;
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

// ✅ USER SPECIFIC START BOT - Har user ka alag session
app.post('/api/start-all', verifyToken, async (req, res) => {
    try {
        const { videoLink, targetViews } = req.body;
        const username = req.user.username;
        const token = req.user.token;
        
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

        // ✅ Stop other users from controlling this user's session
        const userSession = getUserSessionData(username);
        if (userSession.isRunning) {
            return res.json({ success: false, message: 'You already have a running session' });
        }

        // ✅ Update user session
        updateUserSessionData(username, {
            currentVideo: videoLink,
            targetViews: parseInt(targetViews) || 1000,
            isRunning: true,
            success: 0,
            fails: 0,
            reqs: 0,
            startTime: new Date().toISOString()
        });

        const results = [];
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: parseInt(targetViews) || 1000,
                    videoLink: videoLink,
                    mode: 'target',
                    userToken: token // ✅ User identification for bot
                }, { timeout: 10000 });
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

// ✅ USER SPECIFIC STOP BOT - Sirf apna hi stop kar sake
app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const token = req.user.token;
        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        // ✅ Sirf current user ka session stop karo
        updateUserSessionData(username, {
            isRunning: false
        });

        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/stop`, {
                    userToken: token // ✅ User specific stop
                }, { timeout: 10000 });
            } catch (error) {}
        }
        
        res.json({ success: true, message: 'Your bot session stopped' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ USER SPECIFIC STATUS - Sirf apna data dikhao
app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const username = req.user.username;
        const token = req.user.token;
        const instances = await getInstancesFromAuthServer(token);
        const allStatus = [];

        const userSession = getUserSessionData(username);

        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, { 
                    params: { userToken: token },
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

        // ✅ User specific statistics
        const totals = {
            success: userSession.success || 0,
            fails: userSession.fails || 0,
            reqs: userSession.reqs || 0,
            rps: 0, // Calculate based on user data
            onlineBots: allStatus.filter(bot => bot.online && bot.enabled).length,
            totalBots: instances.filter(inst => inst.enabled).length,
            isRunning: userSession.isRunning || false,
            currentVideo: userSession.currentVideo,
            targetViews: userSession.targetViews || 0,
            startTime: userSession.startTime
        };
        
        totals.successRate = totals.reqs > 0 ? ((totals.success / totals.reqs) * 100).toFixed(1) + '%' : '0%';

        // ✅ Calculate RPS based on user session
        if (userSession.startTime) {
            const startTime = new Date(userSession.startTime);
            const now = new Date();
            const diffSeconds = (now - startTime) / 1000;
            if (diffSeconds > 0) {
                totals.rps = (totals.reqs / diffSeconds).toFixed(1);
            }
        }

        res.json({
            success: true,
            instances: allStatus,
            totals: totals,
            userData: userSession
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Initialize user sessions
if (!fs.existsSync(userSessionsFile)) {
    writeUserSessions({});
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ User Isolation: Enabled - Each user has separate data`);
    console.log(`🚀 Unlimited Users Support: Ready`);
});
