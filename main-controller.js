// Generate registration key - UPDATED
async function generateRegistrationKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 12; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // ✅ YAHAN CHANGE: Server pe key update karo
    try {
        const response = await fetch(`${currentConfig.mainControllerUrl}/api/registration-key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ newKey: key })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('registrationKey').value = key;
            document.getElementById('generatedKey').textContent = key;
            document.getElementById('keyDisplay').style.display = 'block';
            
            showMessage('Registration key generated and saved to server!', 'success');
        } else {
            showMessage('Failed to save key to server: ' + data.message, 'error');
        }
    } catch (error) {
        showMessage('Error connecting to server: ' + error.message, 'error');
    }
}

// ✅ NEW: Load current registration key from server
async function loadCurrentKey() {
    if (!currentConfig.mainControllerUrl) return;
    
    try {
        const response = await fetch(`${currentConfig.mainControllerUrl}/api/registration-key`);
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('registrationKey').value = data.key;
            document.getElementById('generatedKey').textContent = data.key;
            document.getElementById('keyDisplay').style.display = 'block';
        }
    } catch (error) {
        console.log('Error loading current key:', error);
    }
}
