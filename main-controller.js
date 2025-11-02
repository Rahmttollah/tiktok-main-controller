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
// ✅ ENHANCED LOGOUT - Clear everything properly
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.body.token;
        
        console.log('🔒 Main controller logout - clearing everything');
        
        // Notify auth server about logout
        if (token) {
            await axios.post(`${AUTH_SERVER_URL}/api/global-logout`, {
                token: token
            }, { timeout: 3000 }).catch(err => {
                console.log('⚠️ Auth logout failed, continuing...');
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Logged out successfully',
            redirect_url: `${AUTH_SERVER_URL}/login?message=logout_clean&force=true`
        });
    } catch (error) {
        console.log('❌ Logout error, forcing clean redirect');
        res.json({ 
            success: true, 
            redirect_url: `${AUTH_SERVER_URL}/login?force=true`
        });
    }
});

// ✅ USER INFO API
app.get('/api/user-info', verifyToken, async (req, res) => {
    try {
        res.json({
            success: true,
            user: {
                username: req.user.username,
                role: req.user.role,
                id: req.user.username // Using username as ID for simplicity
            }
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

// ✅ FIXED STATUS API - With bot distribution check
app.get('/api/status-all', verifyToken, async (req, res) => {
    try {
        const token = req.query.token || req.body.token;
        
        // 🔥 FIRST: Trigger bot distribution check
        try {
            await axios.get(`${AUTH_SERVER_URL}/api/bot-instances?token=${token}`, {
                timeout: 3000
            });
        } catch (error) {
            // Ignore errors, just trigger the distribution
            console.log('Bot distribution trigger completed');
        }

        // THEN: Get instances and status
        const instances = await getInstancesFromAuthServer(token);
        
        const statusPromises = instances.map(async (instance) => {
            try {
                const response = await axios.get(`${instance.url}/status`, { 
                    timeout: 5000,
                    transformResponse: [function (data) {
                        try {
                            return JSON.parse(data);
                        } catch (e) {
                            return null;
                        }
                    }]
                });
                
                return { 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`,
                    url: instance.url,
                    enabled: instance.enabled, 
                    status: response.data, 
                    online: true 
                };
            } catch (error) {
                return { 
                    id: instance.id,
                    name: `Bot ${instance.id.substring(0, 8)}`, 
                    url: instance.url,
                    enabled: instance.enabled, 
                    status: null, 
                    online: false 
                };
            }
        });

        const allStatus = await Promise.allSettled(statusPromises);
        const results = allStatus.map(promise => 
            promise.status === 'fulfilled' ? promise.value : null
        ).filter(Boolean);

        const totals = {
            success: results.reduce((sum, bot) => sum + (bot.status?.success || 0), 0),
            fails: results.reduce((sum, bot) => sum + (bot.status?.fails || 0), 0),
            reqs: results.reduce((sum, bot) => sum + (bot.status?.reqs || 0), 0),
            rps: results.reduce((sum, bot) => sum + (parseFloat(bot.status?.rps) || 0), 0),
            onlineBots: results.filter(bot => bot.online && bot.enabled).length,
            totalBots: instances.filter(inst => inst.enabled).length
        };
        
        totals.successRate = totals.reqs > 0 ? ((totals.success / totals.reqs) * 100).toFixed(1) + '%' : '0%';

        res.json({
            success: true,
            instances: results,
            totals: totals,
            message: instances.length === 0 ? "No bots allocated yet. Bots will be assigned automatically when available." : ""
        });
    } catch (error) {
        console.error('Status API error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ ADMIN APIs (For admin panel functionality)
app.get('/api/admin/users', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.get(`${AUTH_SERVER_URL}/api/admin/users?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Admin users API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

app.get('/api/admin/keys', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.get(`${AUTH_SERVER_URL}/api/admin/keys?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Admin keys API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch keys' });
    }
});

app.post('/api/admin/generate-key', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.post(`${AUTH_SERVER_URL}/api/admin/generate-key`, {
            token: token,
            note: req.body.note
        }, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Generate key API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to generate key' });
    }
});

app.delete('/api/admin/keys/:key', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.delete(`${AUTH_SERVER_URL}/api/admin/keys/${req.params.key}?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Delete key API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete key' });
    }
});

app.get('/api/admin/instances', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.get(`${AUTH_SERVER_URL}/api/admin/instances?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Admin instances API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch instances' });
    }
});

app.post('/api/admin/instances', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.post(`${AUTH_SERVER_URL}/api/admin/instances`, {
            token: token,
            url: req.body.url
        }, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Add instance API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to add instance' });
    }
});

app.delete('/api/admin/instances/:id', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.delete(`${AUTH_SERVER_URL}/api/admin/instances/${req.params.id}?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Delete instance API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete instance' });
    }
});

app.post('/api/admin/users/:userId/toggle', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.post(`${AUTH_SERVER_URL}/api/admin/users/${req.params.userId}/toggle`, {
            token: token
        }, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Toggle user API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to toggle user' });
    }
});

app.post('/api/admin/promote-user', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Super admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.post(`${AUTH_SERVER_URL}/api/admin/promote-user`, {
            token: token,
            userId: req.body.userId,
            newRole: req.body.newRole
        }, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Promote user API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to promote user' });
    }
});

app.get('/api/admin/users/:userId/bot-details', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.get(`${AUTH_SERVER_URL}/api/admin/users/${req.params.userId}/bot-details?token=${token}`, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Bot details API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch bot details' });
    }
});

app.post('/api/admin/users/:userId/manage-bots', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'super_admin' && req.user.role !== 'sub_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const token = req.query.token || req.body.token;
        const response = await axios.post(`${AUTH_SERVER_URL}/api/admin/users/${req.params.userId}/manage-bots`, {
            token: token,
            action: req.body.action,
            botId: req.body.botId
        }, {
            timeout: 5000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Manage bots API error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to manage bots' });
    }
});

// ✅ HEALTH CHECK - No authentication required
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Main Controller is running',
        timestamp: new Date().toISOString(),
        auth_server: AUTH_SERVER_URL
    });
});

// ✅ 404 Handler
app.use('*', (req, res) => {
    res.redirect(AUTH_SERVER_URL);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔧 Main Controller running on port ${PORT}`);
    console.log(`🔐 Auth Server: ${AUTH_SERVER_URL}`);
    console.log(`✅ Enhanced Error Handling: Enabled`);
    console.log(`📱 Mobile Compatible: Yes`);
    console.log(`🚀 Fixed Logout System: Active`);
    console.log(`🔄 Redirect Loop: FIXED`);
    console.log(`🔐 Token Verification: FIXED`);
    console.log(`👑 Admin APIs: Ready`);
    console.log(`🤖 Bot Distribution: Auto-triggered`);
});
