const http = require('http');

// Simple test to check if VR page loads without errors
function testVRPage() {
    console.log('Testing VR Page...');
    
    const options = {
        hostname: 'localhost',
        port: 5001,
        path: '/vr-solar-system.html',
        method: 'GET'
    };
    
    const req = http.request(options, (res) => {
        console.log(`Status Code: ${res.statusCode}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            // Check if key elements are present
            const hasContainer = data.includes('id="vr-container"');
            const hasLoading = data.includes('Initializing VR Experience');
            const hasErrorHandling = data.includes('global error handling');
            
            console.log('VR Page Analysis:');
            console.log(`- Has container: ${hasContainer}`);
            console.log(`- Has loading indicator: ${hasLoading}`);
            console.log(`- Has error handling: ${hasErrorHandling}`);
            
            if (hasContainer && hasLoading) {
                console.log('✅ VR page structure looks good');
            } else {
                console.log('❌ VR page structure has issues');
            }
        });
    });
    
    req.on('error', (error) => {
        console.error('Error testing VR page:', error.message);
    });
    
    req.end();
}

testVRPage();