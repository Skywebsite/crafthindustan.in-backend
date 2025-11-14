const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';

console.log('=== DATABASE CONNECTION CHECK ===');
console.log('MongoDB URI from .env:', MONGODB_URI);
console.log('');

mongoose.connect(MONGODB_URI)
  .then(async () => {
    const db = mongoose.connection.db;
    const Post = require('./models/Post');
    
    console.log('✅ Connected to MongoDB');
    console.log('📍 Connection String:', MONGODB_URI);
    console.log('📍 Database Name:', db.databaseName);
    console.log('📍 Host:', mongoose.connection.host);
    console.log('📍 Port:', mongoose.connection.port);
    console.log('');
    
    const collections = await db.listCollections().toArray();
    console.log('📁 Collections:', collections.map(c => c.name).join(', '));
    console.log('');
    
    const postCount = await Post.countDocuments();
    console.log('📊 Total Posts:', postCount);
    
    if (postCount > 0) {
      const latestPost = await Post.findOne().sort({ createdAt: -1 });
      console.log('📝 Latest Post:');
      console.log('   Title:', latestPost.title);
      console.log('   ID:', latestPost._id);
      console.log('   Created:', latestPost.createdAt);
    }
    
    console.log('');
    console.log('✅ Data is being saved to:', db.databaseName);
    console.log('✅ Connection Type: Local MongoDB (localhost)');
    console.log('');
    console.log('To view in MongoDB Compass:');
    console.log('1. Connect to: mongodb://localhost:27017');
    console.log('2. Select database: craft-hindustan');
    console.log('3. Open collection: posts');
    
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Connection Error:', err.message);
    process.exit(1);
  });

