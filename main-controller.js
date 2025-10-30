const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'tiktok-multi-bot-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'TIKTOK123';

// User storage
const usersFile = 'users.json';
function readUsers() {
    try {
        if (fs.existsSync(usersFile)) {
            return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        }
    } catch (error) {
        console.log('Error reading users:', error);
    }
    return [];
}

function writeUsers(users) {
    try {
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        return true;
    } catch (error) {
        console.log('Error writing users:', error);
        return false;
    }
}

// Instances storage - FIXED PATH
const instancesFile = path.join(__dirname, 'instances.json');

function readInstances() {
    try {
        if (fs.existsSync(instancesFile)) {
            const data = fs.readFileSync(instancesFile, 'utf8');
            return JSON.parse(data);
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

// Auth middleware - FIXED
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }
}

// Routes
app.get('/', (req, res) => {
    req.session.user ? res.redirect('/dashboard') : res.redirect('/login');
});

app.get('/login', (req, res) => {
    req.session.user ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    req.session.user ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Auth APIs
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, registrationKey } = req.body;
        
        if (!username || !password || !registrationKey) {
            return res.json({ success: false, message: 'All fields required' });
        }

        if (registrationKey !== REGISTRATION_KEY) {
            return res.json({ success: false, message: 'Invalid registration key' });
        }

        const users = readUsers();
        if (users.find(u => u.username === username)) {
            return res.json({ success: false, message: 'Username exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword, createdAt: new Date().toISOString() });
        
        writeUsers(users) ? 
            res.json({ success: true, message: 'Registration successful' }) :
            res.json({ success: false, message: 'Registration failed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body;

        if (!username || !password) {
            return res.json({ success: false, message: 'Username and password required' });
        }

        const users = readUsers();
        const user = users.find(u => u.username === username);
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false, message: 'Invalid credentials' });
        }

        req.session.user = { username };
        if (rememberMe) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        
        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logout successful' });
});

// Instances APIs - FIXED ALL ERRORS
app.get('/api/instances', requireAuth, (req, res) => {
    try {
        const instances = readInstances();
        res.json({ success: true, instances: instances });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error reading instances' });
    }
});

app.post('/api/instances', requireAuth, (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.json({ success: false, message: 'URL required' });
        }
        
        // Validate URL format
        try {
            new URL(url);
        } catch (error) {
            return res.json({ success: false, message: 'Invalid URL format' });
        }

        const instances = readInstances();
        
        // Check if URL already exists
        if (instances.find(inst => inst.url === url)) {
            return res.json({ success: false, message: 'Instance URL already exists' });
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
        console.log('Instance add error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/instances/:id', requireAuth, (req, res) => {
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

// Bot Control APIs
app.post('/api/start-all', requireAuth, async (req, res) => {
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
        
        // Test each instance first
        for (const instance of instances) {
            try {
                // Test if instance is reachable
                await axios.get(`${instance.url}/`, { timeout: 5000 });
                results.push({ instance: instance.url, success: true, message: 'Online' });
            } catch (error) {
                results.push({ instance: instance.url, success: false, message: 'Offline' });
            }
        }

        // Start only online instances
        const onlineInstances = instances.filter((inst, index) => results[index].success);
        
        for (const instance of onlineInstances) {
            try {
                await axios.post(`${instance.url}/start`, {
                    targetViews: parseInt(targetViews) || 1000,
                    videoLink: videoLink,
                    mode: 'target'
                }, { timeout: 10000 });
            } catch (error) {
                console.log(`Error starting ${instance.url}:`, error.message);
            }
        }

        const successful = onlineInstances.length;
        res.json({
            success: successful > 0,
            message: `${successful}/${instances.length} instances started successfully`,
            results: results
        });
    } catch (error) {
        console.log('Start all error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/stop-all', requireAuth, async (req, res) => {
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

app.get('/api/status-all', requireAuth, async (req, res) => {
    try {
        const instances = readInstances();
        const allStatus = [];

        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance.url}/status`, { timeout: 10000 });
                allStatus.push({ 
                    id: instance.id, 
                    url: instance.url, 
                    enabled: instance.enabled, 
                    status: response.data, 
                    online: true 
                });
            } catch (error) {
                allStatus.push({ 
                    id: instance.id, 
                    url: instance.url, 
                    enabled: instance.enabled, 
                    status: null, 
                    online: false,
                    error: error.message 
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
        console.log('Status all error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// 404 handler for API routes - FIXED
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// Serve static files for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Main Controller running on port ${PORT}`);
    console.log(`🔑 Registration Key: ${REGISTRATION_KEY}`);
    
    // Initialize instances file if not exists
    if (!fs.existsSync(instancesFile)) {
        writeInstances([]);
        console.log('📁 Instances file initialized');
    }
});
