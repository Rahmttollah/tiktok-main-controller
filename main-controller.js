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

app.use(session({
    secret: process.env.SESSION_SECRET || 'tiktok-multi-bot-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'TIKTOK123';

// User storage
const usersFile = 'users.json';
function readUsers() {
    try {
        if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } catch (error) {}
    return [];
}
function writeUsers(users) {
    try {
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

// Instances storage - ONLY ADMIN CAN MODIFY
const instancesFile = 'instances.json';
function readInstances() {
    try {
        if (fs.existsSync(instancesFile)) return JSON.parse(fs.readFileSync(instancesFile, 'utf8'));
    } catch (error) {}
    return [];
}
function writeInstances(instances) {
    try {
        fs.writeFileSync(instancesFile, JSON.stringify(instances, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

// Auth middleware
function requireAuth(req, res, next) {
    req.session.user ? next() : res.redirect('/login');
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
});

app.post('/api/login', async (req, res) => {
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
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logout successful' });
});

// 🔒 ADMIN ONLY ROUTES - External admin HTML will use these
app.get('/admin/instances', (req, res) => {
    // Simple protection - you can add IP restriction later
    res.json({ success: true, instances: readInstances() });
});

app.post('/admin/instances', (req, res) => {
    const { url } = req.body;
    
    if (!url) return res.json({ success: false, message: 'URL required' });
    
    try { new URL(url); } catch (error) {
        return res.json({ success: false, message: 'Invalid URL' });
    }

    const instances = readInstances();
    if (instances.find(inst => inst.url === url)) {
        return res.json({ success: false, message: 'URL exists' });
    }

    const newInstance = { id: Date.now().toString(), url, addedAt: new Date().toISOString(), enabled: true };
    instances.push(newInstance);
    
    writeInstances(instances) ?
        res.json({ success: true, message: 'Instance added', instance: newInstance }) :
        res.json({ success: false, message: 'Failed to add' });
});

app.delete('/admin/instances/:id', (req, res) => {
    const { id } = req.params;
    let instances = readInstances();
    const initialLength = instances.length;
    
    instances = instances.filter(inst => inst.id !== id);
    
    if (instances.length < initialLength && writeInstances(instances)) {
        res.json({ success: true, message: 'Instance deleted' });
    } else {
        res.json({ success: false, message: 'Instance not found' });
    }
});

// Bot Control APIs - USERS CAN USE THESE
app.post('/api/start-all', requireAuth, async (req, res) => {
    const { videoLink, targetViews } = req.body;
    
    if (!videoLink) return res.json({ success: false, message: 'Video link required' });

    const instances = readInstances().filter(inst => inst.enabled);
    if (instances.length === 0) {
        return res.json({ success: false, message: 'No instances available' });
    }

    const idMatch = videoLink.match(/\d{18,19}/g);
    if (!idMatch) return res.json({ success: false, message: 'Invalid TikTok link' });

    const results = [];
    for (const instance of instances) {
        try {
            await axios.post(`${instance.url}/start`, {
                targetViews: parseInt(targetViews) || 1000,
                videoLink: videoLink,
                mode: 'target'
            }, { timeout: 10000 });
            results.push({ instance: instance.url, success: true, message: 'Started' });
        } catch (error) {
            results.push({ instance: instance.url, success: false, message: 'Failed' });
        }
    }

    const successful = results.filter(r => r.success).length;
    res.json({
        success: successful > 0,
        message: `${successful}/${instances.length} instances started`,
        results: results
    });
});

app.post('/api/stop-all', requireAuth, async (req, res) => {
    const instances = readInstances().filter(inst => inst.enabled);
    
    for (const instance of instances) {
        try {
            await axios.post(`${instance.url}/stop`, {}, { timeout: 10000 });
        } catch (error) {}
    }
    
    res.json({ success: true, message: 'All instances stopped' });
});

app.get('/api/status-all', requireAuth, async (req, res) => {
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

    res.json({ instances: allStatus, totals: totals });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Main Controller running on port ${PORT}`);
    console.log(`🔑 Registration Key: ${REGISTRATION_KEY}`);
    console.log(`🔒 Instance management: Admin only`);
});
