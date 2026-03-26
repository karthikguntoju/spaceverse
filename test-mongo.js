const mongoose = require('mongoose');
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']);

const uri = process.env.MONGODB_URI;
console.log('Connecting to:', uri);

mongoose.connect(uri)
    .then(() => {
        console.log('Pinged your deployment. You successfully connected to MongoDB!');
        process.exit(0);
    })
    .catch(err => {
        console.error('Connection error:', err);
        process.exit(1);
    });
