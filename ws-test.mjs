import WebSocket from 'ws';

function testConnection(url) {
    console.log('Testing', url);
    const ws = new WebSocket(url);
    ws.on('open', () => {
        console.log('SUCCESS', url);
        ws.close();
    });
    ws.on('error', (err) => {
        console.error('ERROR', url, err.message);
    });
    ws.on('unexpected-response', (req, res) => {
        console.error('UNEXPECTED', url, res.statusCode);
    });
}

testConnection('ws://localhost:3001/api/chat/test');
testConnection('ws://localhost:5173/api/chat/test');
