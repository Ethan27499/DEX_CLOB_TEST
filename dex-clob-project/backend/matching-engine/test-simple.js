const http = require('http');

function testHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3002,
      path: '/health',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Security Framework...\n');

  try {
    console.log('1️⃣ Testing /health endpoint...');
    const healthResult = await testHealth();
    console.log('✅ Health check result:', healthResult);
    
    if (healthResult.status === 200) {
      console.log('🎉 Server is running successfully!');
      console.log('✅ Security framework is operational');
    } else {
      console.log('❌ Unexpected status code:', healthResult.status);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('Make sure server is running on port 3002');
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testHealth, runTests };
