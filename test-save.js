const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log('Database:', mongoose.connection.db.databaseName);
    
    const Post = require('./models/Post');
    const User = require('./models/User');
    
    // Get a test user
    const user = await User.findOne({ email: 'abbupasha61@gmail.com' });
    if (!user) {
      console.error('User not found');
      process.exit(1);
    }
    
    console.log('Test user found:', user._id);
    
    // Count before
    const countBefore = await Post.countDocuments();
    console.log('Posts before save:', countBefore);
    
    // Create a test post
    const testPost = new Post({
      title: 'TEST POST - ' + new Date().toISOString(),
      description: 'This is a test post to verify MongoDB save operation',
      category: 'Other',
      price: 100,
      images: ['https://test.com/image.jpg'],
      tags: ['test'],
      status: 'published',
      author: user._id,
      authorName: user.name,
      authorEmail: user.email
    });
    
    console.log('\n=== SAVING POST ===');
    const savedPost = await testPost.save();
    console.log('Post saved with ID:', savedPost._id);
    
    // Verify immediately
    const verified = await Post.findById(savedPost._id);
    console.log('Verified post exists:', !!verified);
    
    // Count after
    const countAfter = await Post.countDocuments();
    console.log('Posts after save:', countAfter);
    
    // Wait a bit and verify again
    await new Promise(resolve => setTimeout(resolve, 1000));
    const verifiedAgain = await Post.findById(savedPost._id);
    console.log('Verified again after 1 second:', !!verifiedAgain);
    
    // Get all posts
    const allPosts = await Post.find().sort({ createdAt: -1 }).limit(5);
    console.log('\n=== LAST 5 POSTS ===');
    allPosts.forEach((p, i) => {
      console.log(`${i+1}. ${p.title} (ID: ${p._id})`);
    });
    
    // Clean up test post
    await Post.deleteOne({ _id: savedPost._id });
    console.log('\n✅ Test post deleted');
    
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

