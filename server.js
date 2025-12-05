const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Middleware - CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : [
          'http://localhost:3000', 
          'http://localhost:3001',
          'https://crafthindustan.vercel.app',
          'https://crafthindustan-in.vercel.app',
          'https://www.crafthindustan.com',
          'https://crafthindustan.com'
        ];
    
    // Always allow the request (for now, to fix CORS issues)
    // In production, you can restrict this to only allowed origins
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

// Increase body size limit for file uploads (Vercel has 4.5MB limit, but we'll set higher for local dev)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/craft-hindustan';

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB');
  console.log('📍 MongoDB URI:', MONGODB_URI);
  console.log('📍 Database:', mongoose.connection.db?.databaseName || 'craft-hindustan');
  console.log('📍 Collections:', Object.keys(mongoose.connection.collections));
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));

// Log registered routes
console.log('📋 Registered API routes:');
console.log('   GET    /api/brands - Get all brands (public)');
console.log('   POST   /api/brands - Create brand');
console.log('   GET    /api/brands/my-brands - Get user brand');
console.log('   GET    /api/brands/:id - Get brand by ID');
console.log('   PUT    /api/brands/:id - Update brand');
console.log('   GET    /api/admin/stats - Get admin statistics');
console.log('   GET    /api/admin/users - Get all users (admin only)');
console.log('   GET    /api/admin/products - Get all products (admin only)');
console.log('   GET    /api/admin/brands - Get all brands (admin only)');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend server is running',
    timestamp: new Date().toISOString()
  });
});

// Cloudinary test endpoint
app.get('/api/test/cloudinary', async (req, res) => {
  try {
    const cloudinary = require('./config/cloudinary');
    
    // Test Cloudinary connection by getting account details
    const result = await cloudinary.api.ping();
    
    res.json({
      success: true,
      message: 'Cloudinary is working!',
      cloudinary: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        status: result.status === 'ok' ? 'Connected' : 'Unknown',
        ping: result
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Cloudinary test failed',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    error: 'Something went wrong!',
    message: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Route not found' 
  });
});

const PORT = process.env.PORT || 5000;
const allowedSocketOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

const io = new Server(server, {
  cors: {
    origin: allowedSocketOrigins,
    credentials: true
  }
});

app.set('io', io);

const onlineUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('name email photoURL');
    if (!user) {
      return next(new Error('Authentication error'));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user?._id?.toString();
  if (userId) {
    onlineUsers.set(userId, socket.id);
  }

  socket.emit('connection:ready', { userId });

  socket.on('conversation:join', (conversationId) => {
    if (conversationId) {
      socket.join(conversationId.toString());
    }
  });

  socket.on('conversation:leave', (conversationId) => {
    if (conversationId) {
      socket.leave(conversationId.toString());
    }
  });

  socket.on('message:send', async ({ conversationId, content }) => {
    try {
      if (!conversationId || !content || !content.trim()) {
        return;
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return socket.emit('message:error', { message: 'Conversation not found' });
      }

      const isParticipant = conversation.participants.some(
        (participant) => participant.toString() === userId
      );

      if (!isParticipant) {
        return socket.emit('message:error', { message: 'Not authorized for this conversation' });
      }

      const message = await Message.create({
        conversation: conversationId,
        sender: socket.user._id,
        content: content.trim(),
        readBy: [socket.user._id]
      });

      conversation.lastMessage = {
        content: content.trim(),
        sender: socket.user._id,
        createdAt: message.createdAt
      };
      await conversation.save();

      const populatedMessage = await message.populate('sender', 'name email photoURL');
      io.to(conversationId.toString()).emit('message:new', {
        conversationId: conversationId.toString(),
        message: populatedMessage
      });
      io.to(conversationId.toString()).emit('conversation:update', {
        conversationId: conversationId.toString(),
        lastMessage: conversation.lastMessage,
        updatedAt: conversation.updatedAt
      });
    } catch (error) {
      console.error('Socket message error:', error);
      socket.emit('message:error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    if (userId) {
      onlineUsers.delete(userId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📍 Brands API: http://localhost:${PORT}/api/brands`);
  console.log(`💬 WebSocket ready at ws://localhost:${PORT}`);
});

