const net = require('net');

const client = new net.Socket();
client.connect(27017, '159.41.192.132', function() {
    console.log('TCP Connect to MongoDB IP successful');
    client.destroy();
});

client.on('error', function(err) {
    console.log('TCP Connect to MongoDB IP Failed: ' + err.message);
});
