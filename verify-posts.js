const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    const Post = require('./models/Post');
    const db = mongoose.connection.db;
    
    console.log('=== DATABASE VERIFICATION ===');
    console.log('Database name:', db.databaseName);
    console.log('MongoDB URI:', MONGODB_URI);
    
    const collections = await db.listCollections().toArray();
    console.log('\nCollections:', collections.map(c => c.name));
    
    const count = await Post.countDocuments();
    console.log('\nTotal posts:', count);
    
    const posts = await Post.find().sort({ createdAt: -1 }).select('title createdAt _id author');
    console.log('\nAll posts:');
    posts.forEach((p, i) => {
      console.log(`${i+1}. ID: ${p._id}`);
      console.log(`   Title: ${p.title}`);
      console.log(`   Created: ${p.createdAt}`);
      console.log(`   Author: ${p.author}`);
      console.log('');
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

