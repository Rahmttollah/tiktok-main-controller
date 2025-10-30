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

// ✅ REGISTRATION KEY SYSTEM FIXED
const registrationFile = 'registration-key.json';

function readRegistrationKey() {
    try {
        if (fs.existsSync(registrationFile)) {
            const data = JSON.parse(fs.readFileSync(registrationFile, 'utf8'));
            return data.key || 'TIKTOK123'; // Default key
        }
    } catch (error) {
        console.log('Error reading registration key:', error);
    }
    return 'TIKTOK123'; // Default key
}

function writeRegistrationKey(key) {
    try {
        fs.writeFileSync(registrationFile, JSON.stringify({ key: key, updatedAt: new Date().toISOString() }, null, 2));
        return true;
    } catch (error) {
        console.log('Error writing registration key:', error);
        return false;
    }
}

// Get current registration key
function getCurrentRegistrationKey() {
    return readRegistrationKey();
}

// User storage
const usersFile = 'users.json';
function readUsers() {
    try {
        if (fs.existsSync(usersFile)) {
            return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        }
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

// Instances storage
const instancesFile = 'instances.json';
function readInstances() {
    try {
        if (fs.existsSync(instancesFile)) {
            return JSON.parse(fs.readFileSync(instancesFile, 'utf8'));
        }
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

let activeBots = [];

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
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

// ✅ NEW: Get current registration key API
app.get('/api/registration-key', (req, res) => {
    res.json({ 
        success: true, 
        key: getCurrentRegistrationKey(),
        message: 'Current registration key'
    });
});

// ✅ NEW: Update registration key API (Admin use karega)
app.post('/api/registration-key', (req, res) => {
    const { newKey } = req.body;
    
    if (!newKey || newKey.length < 6) {
        return res.json({ success: false, message: 'Valid key required (min 6 characters)' });
    }

    if (writeRegistrationKey(newKey)) {
        res.json({ 
            success: true, 
            message: 'Registration key updated successfully',
            key: newKey
        });
    } else {
        res.json({ success: false, message: 'Failed to update key' });
    }
});

// ✅ FIXED: Registration API (Ab dynamic key use karega)
app.post('/api/register', async (req, res) => {
    const { username, password, registrationKey } = req.body;
    
    if (!username || !password || !registrationKey) {
        return res.json({ success: false, message: 'All fields required' });
    }

    // ✅ YAHAN CHANGE HUA: Dynamic key check
    const currentKey = getCurrentRegistrationKey();
    if (registrationKey !== currentKey) {
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

// ✅ Rest of the code same as before...
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

// Instances APIs (Normal users ke liye HATA DO)
app.get('/api/instances', requireAuth, (req, res) => {
    res.json({ success: true, instances: readInstances() });
});

app.post('/api/instances', requireAuth, (req, res) => {
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

app.delete('/api/instances/:id', requireAuth, (req, res) => {
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

// Bot Control APIs (Same as before)
app.post('/api/start-all', requireAuth, async (req, res) => {
    const { videoLink, targetViews } = req.body;
    
    if (!videoLink) return res.json({ success: false, message: 'Video link required' });

    const instances = readInstances().filter(inst => inst.enabled);
    if (instances.length === 0) {
        return res.json({ success: false, message: 'No instances' });
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
        message: `${successful}/${instances.length} started`,
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
            allStatus.push({ id: instance.id, url: instance.url, enabled: instance.enabled, status: response.data, online: true });
        } catch (error) {
            allStatus.push({ id: instance.id, url: instance.url, enabled: instance.enabled, status: null, online: false });
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
    console.log(`🔑 Current Registration Key: ${getCurrentRegistrationKey()}`);
});
