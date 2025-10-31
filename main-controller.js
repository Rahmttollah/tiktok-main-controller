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

// ✅ REMOVE LOCAL INSTANCES STORAGE - Auth server se manage hoga
// const instancesFile = path.join(__dirname, 'instances.json'); - DELETE THIS

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
            req.user = { username: response.data.username };
            next();
        } else {
            return res.redirect(AUTH_SERVER_URL);
        }
    } catch (error) {
        return res.redirect(AUTH_SERVER_URL);
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ✅ REMOVE ADMIN ROUTE FROM MAIN CONTROLLER
// app.get('/admin', ...) - DELETE THIS

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

// ✅ REMOVE INSTANCE MANAGEMENT APIS FROM MAIN CONTROLLER
// app.post('/api/instances', ...) - DELETE THIS
// app.delete('/api/instances/:id', ...) - DELETE THIS

// ✅ Start/Stop/Status APIs (existing code)
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

app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        const instances = await getInstancesFromAuthServer(token);
        const enabledInstances = instances.filter(inst => inst.enabled);
        
        for (const instance of enabledInstances) {
            try {
                await axios.post(`${instance.url}/stop`, {}, { timeout: 10000 });
            } catch (error) {}
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
                const response = await axios.get(`${instance.url}/status`, { timeout: 10000 });
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ Cross-domain authentication: Enabled`);
});
