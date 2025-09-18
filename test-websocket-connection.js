// Test script to verify relay server connectivity
const WebSocket = require('ws');

const testRelay = async () => {
  console.log('🔌 Testing WebSocket Relay Connection\n');
  
  const relayUrl = 'ws://localhost:7789/relay';
  console.log(`Testing connection to: ${relayUrl}`);
  
  try {
    const ws = new WebSocket(relayUrl);
    
    ws.on('open', () => {
      console.log('✅ Successfully connected to relay server!');
      console.log('📊 Connection details:', {
        readyState: ws.readyState,
        url: ws.url,
        protocol: ws.protocol
      });
      ws.close();
    });
    
    ws.on('error', (error) => {
      console.error('❌ Failed to connect to relay server:');
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        address: error.address,
        port: error.port
      });
    });
    
    ws.on('close', (code, reason) => {
      console.log(`🔒 Connection closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.log('⏰ Connection timeout after 5 seconds');
        ws.close();
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Exception during connection attempt:', error);
  }
};

// Also test direct backpack.tf connection for comparison
const testDirect = async () => {
  console.log('\n🌐 Testing Direct Backpack.tf Connection\n');
  
  const directUrl = 'wss://ws.backpack.tf/events/';
  console.log(`Testing connection to: ${directUrl}`);
  
  try {
    const ws = new WebSocket(directUrl, {
      headers: {
        'batch-test': true,
      }
    });
    
    ws.on('open', () => {
      console.log('✅ Successfully connected to backpack.tf!');
      console.log('📊 Connection details:', {
        readyState: ws.readyState,
        url: ws.url,
        protocol: ws.protocol
      });
      ws.close();
    });
    
    ws.on('error', (error) => {
      console.error('❌ Failed to connect to backpack.tf:');
      console.error('Error details:', error.message);
    });
    
    ws.on('close', (code, reason) => {
      console.log(`🔒 Connection closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.log('⏰ Connection timeout after 5 seconds');
        ws.close();
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Exception during connection attempt:', error);
  }
};

// Run tests
console.log('Starting WebSocket connectivity tests...\n');
testRelay();
setTimeout(testDirect, 6000); // Run after relay test completes