const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Auth Server URL - UPDATE THIS WITH YOUR AUTH SERVER URL
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'https://tiktok-bot-auth.up.railway.app';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Instances storage
const instancesFile = path.join(__dirname, 'instances.json');

function readInstances() {
    try {
        if (fs.existsSync(instancesFile)) {
            return JSON.parse(fs.readFileSync(instancesFile, 'utf8'));
        }
    } catch (error) {
        console.log('Error reading instances:', error);
    }
    return [];
}

function writeInstances(instances) {
    try {
        fs.writeFileSync(instancesFile, JSON.stringify(instances, null, 2));
        return true;
    } catch (error) {
        console.log('Error writing instances:', error);
        return false;
    }
}

// Token verification middleware
async function verifyToken(req, res, next) {
    try {
        const token = req.query.token || req.body.token;
        
        if (!token) {
            return res.redirect(AUTH_SERVER_URL);
        }

        // Verify token with auth server
        const response = await axios.post(`${AUTH_SERVER_URL}/api/verify-token`, {
            token: token
        });

        if (response.data.success && response.data.valid) {
            req.user = { 
                username: response.data.username,
                isAdmin: response.data.isAdmin
            };
            next();
        } else {
            return res.redirect(AUTH_SERVER_URL);
        }
    } catch (error) {
        console.log('Token verification error:', error);
        return res.redirect(AUTH_SERVER_URL);
    }
}

// Admin check middleware
function requireAdmin(req, res, next) {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Admin access required' });
    }
}

// Routes
app.get('/', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin-panel', verifyToken, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-panel.html'));
});

// Protected APIs
app.get('/api/instances', verifyToken, (req, res) => {
    try {
        const instances = readInstances();
        
        // For normal users, show only instance names and status
        // For admin, show full details including URLs
        const safeInstances = instances.map(instance => {
            if (req.user.isAdmin) {
                return {
                    id: instance.id,
                    name: `Bot Instance ${instance.id.substring(0, 8)}`,
                    url: instance.url,
                    status: 'active',
                    addedAt: instance.addedAt,
                    enabled: instance.enabled
                };
            } else {
                return {
                    id: instance.id,
                    name: `Bot Instance ${instance.id.substring(0, 8)}`,
                    status: 'active',
                    addedAt: instance.addedAt,
                    enabled: instance.enabled
                    // URL hidden for normal users
                };
            }
        });
        
        res.json({ success: true, instances: safeInstances });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/instances', verifyToken, requireAdmin, (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.json({ success: false, message: 'URL required' });
        }
        
        try {
            new URL(url);
        } catch (error) {
            return res.json({ success: false, message: 'Invalid URL' });
        }

        const instances = readInstances();
        
        if (instances.find(inst => inst.url === url)) {
            return res.json({ success: false, message: 'Instance already exists' });
        }

        const newInstance = { 
            id: Date.now().toString(), 
            url: url.trim(), 
            addedAt: new Date().toISOString(), 
            enabled: true 
        };

        instances.push(newInstance);
        
        if (writeInstances(instances)) {
            res.json({ 
                success: true, 
                message: 'Instance added successfully',
                instance: newInstance
            });
        } else {
            res.json({ success: false, message: 'Failed to add instance' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/instances/:id', verifyToken, requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        let instances = readInstances();
        const initialLength = instances.length;
        
        instances = instances.filter(inst => inst.id !== id);
        
        if (instances.length < initialLength) {
            if (writeInstances(instances)) {
                res.json({ success: true, message: 'Instance deleted successfully' });
            } else {
                res.json({ success: false, message: 'Failed to delete instance' });
            }
        } else {
            res.json({ success: false, message: 'Instance not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/start-all', verifyToken, async (req, res) => {
    try {
        const { videoLink, targetViews } = req.body;
        
        if (!videoLink) {
            return res.json({ success: false, message: 'Video link required' });
        }

        const instances = readInstances().filter(inst => inst.enabled);
        if (instances.length === 0) {
            return res.json({ success: false, message: 'No bot instances configured' });
        }

        const idMatch = videoLink.match(/\d{18,19}/g);
        if (!idMatch) {
            return res.json({ success: false, message: 'Invalid TikTok video link' });
        }

        const results = [];
        
        // Start all enabled instances
        for (const instance of instances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: parseInt(targetViews) || 1000,
                    videoLink: videoLink,
                    mode: 'target'
                }, { timeout: 10000 });
                results.push({ 
                    instance: instance.id, 
                    success: true, 
                    message: 'Started successfully' 
                });
            } catch (error) {
                results.push({ 
                    instance: instance.id, 
                    success: false, 
                    message: 'Failed to start' 
                });
            }
        }

        const successful = results.filter(r => r.success).length;
        res.json({
            success: successful > 0,
            message: `${successful}/${instances.length} instances started successfully`,
            results: results
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/stop-all', verifyToken, async (req, res) => {
    try {
        const instances = readInstances().filter(inst => inst.enabled);
        
        for (const instance of instances) {
            try {
                await axios.post(`${instance.url}/stop`, {}, { timeout: 10000 });
            } catch (error) {
                // Ignore errors when stopping
            }
        }
        
        res.json({ success: true, message: 'All instances stopped' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const instances = readInstances();
        const allStatus = [];

        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, { timeout: 10000 });
                allStatus.push({ 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`,
                    // Hide URL from normal users, show only to admin
                    url: req.user.isAdmin ? instance.url : 'Hidden',
                    enabled: instance.enabled, 
                    status: response.data, 
                    online: true 
                });
            } catch (error) {
                allStatus.push({ 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`,
                    url: req.user.isAdmin ? instance.url : 'Hidden',
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
            totals: totals,
            user: {
                username: req.user.username,
                isAdmin: req.user.isAdmin
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// User profile API
app.get('/api/user/profile', verifyToken, (req, res) => {
    res.json({
        success: true,
        user: {
            username: req.user.username,
            isAdmin: req.user.isAdmin
        }
    });
});

// Initialize
if (!fs.existsSync(instancesFile)) {
    writeInstances([]);
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`🔒 Token Protection: ENABLED`);
});
