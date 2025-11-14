const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@crafthindustan.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin User';

async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
    if (existingAdmin) {
      console.log(`⚠️  Admin user with email ${ADMIN_EMAIL} already exists!`);
      console.log('   You can login with this email and your existing password.');
      process.exit(0);
    }

    // Create admin user (password will be hashed by pre-save hook)
    const admin = new User({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD, // Will be hashed by pre-save hook
      provider: 'local'
    });

    await admin.save();
    
    // Verify password was saved
    const savedAdmin = await User.findOne({ email: ADMIN_EMAIL }).select('+password');
    if (!savedAdmin || !savedAdmin.password) {
      throw new Error('Failed to save password');
    }
    console.log('✅ Admin user created successfully!');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log('\n⚠️  IMPORTANT: Change the password after first login!');
    console.log('\n📝 To use this admin account:');
    console.log(`   1. Login at http://localhost:3001`);
    console.log(`   2. Email: ${ADMIN_EMAIL}`);
    console.log(`   3. Password: ${ADMIN_PASSWORD}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();

