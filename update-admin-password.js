const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@crafthindustan.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function updateAdminPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find admin user
    const admin = await User.findOne({ email: ADMIN_EMAIL }).select('+password');
    if (!admin) {
      console.log(`❌ Admin user with email ${ADMIN_EMAIL} not found!`);
      console.log('   Run: npm run create-admin');
      process.exit(1);
    }

    // Update password (will be hashed by pre-save hook)
    admin.password = ADMIN_PASSWORD;
    await admin.save();

    // Verify password was saved
    const updatedAdmin = await User.findOne({ email: ADMIN_EMAIL }).select('+password');
    if (!updatedAdmin || !updatedAdmin.password) {
      throw new Error('Failed to save password');
    }

    console.log('✅ Admin password updated successfully!');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log('\n📝 You can now login with these credentials:');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating admin password:', error);
    process.exit(1);
  }
}

updateAdminPassword();

