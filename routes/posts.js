const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const cloudinary = require('../config/cloudinary');
const Post = require('../models/Post');
const User = require('../models/User');
const Brand = require('../models/Brand');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024, // 1MB limit per file (compressed images should be ~800KB)
    files: 5 // Maximum 5 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token decoded, userId:', decoded.userId);
    
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      console.error('User not found for userId:', decoded.userId);
      console.error('Token payload:', decoded);
      
      // Check if user exists with different ID format
      const allUsers = await User.find().limit(5).select('_id email name');
      console.log('Available users:', allUsers.map(u => ({ id: u._id, email: u.email })));
      
      return res.status(404).json({
        success: false,
        error: 'User not found. Please log in again.',
        details: 'The user associated with this token no longer exists in the database.'
      });
    }

    console.log('User authenticated:', user.email, user._id);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      console.error('JWT Error:', error.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Token verification failed',
      message: error.message
    });
  }
};

// Helper function to upload image to Cloudinary
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'craft-hindustan',
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      }
    ).end(buffer);
  });
};

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size too large. Maximum size is 1MB per image (images are automatically compressed)'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum is 5 images'
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message || 'File upload error'
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'File upload error'
    });
  }
  next();
};

// @route   POST /api/posts
// @desc    Create a new post
// @access  Private
router.post('/', authenticateToken, (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    next();
  });
}, [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Description must be at least 10 characters long'),
  body('category')
    .isIn(['Painting', 'Drawing', 'Sculpture', 'Pottery', 'Textiles', 'Jewelry', 'Woodwork', 'Paper Crafts', 'Metalwork', 'Other'])
    .withMessage('Invalid category'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('brand')
    .notEmpty()
    .withMessage('Brand is required')
], async (req, res) => {
  try {
    console.log('=== CREATE POST REQUEST ===');
    console.log('Files received:', {
      hasFiles: !!req.files,
      filesCount: req.files?.length || 0,
      fileNames: req.files?.map(f => f.originalname) || []
    });
    console.log('Form data:', {
      title: req.body.title,
      description: req.body.description?.substring(0, 50) + '...',
      category: req.body.category,
      price: req.body.price,
      tags: req.body.tags
    });
    console.log('User info:', {
      userId: req.user?._id,
      userName: req.user?.name,
      userEmail: req.user?.email
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Check if images were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one image is required'
      });
    }

    console.log('Uploading', req.files.length, 'images to Cloudinary...');

    // Upload images to Cloudinary with error handling
    const imageUploads = req.files.map(file => 
      uploadToCloudinary(file.buffer).catch(err => {
        console.error('Cloudinary upload error:', err);
        throw new Error(`Failed to upload image: ${err.message}`);
      })
    );
    
    const imageUrls = await Promise.all(imageUploads);

    console.log('Images uploaded to Cloudinary:', imageUrls.length);
    console.log('Image URLs:', imageUrls);

    const { title, description, category, price, tags, status, brand, quantity, location } = req.body;

    // Validate brand exists and belongs to user
    const brandDoc = await Brand.findById(brand);
    if (!brandDoc) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }

    if (brandDoc.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'You can only post to your own brands'
      });
    }

    // Parse tags if it's a string
    let parsedTags = [];
    if (tags) {
      if (typeof tags === 'string') {
        parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      } else if (Array.isArray(tags)) {
        parsedTags = tags;
      }
    }

    const post = new Post({
      title: title.trim(),
      description: description.trim(),
      category,
      price: parseFloat(price),
      images: imageUrls,
      tags: parsedTags,
      status: status || 'published',
      author: req.user._id,
      authorName: req.user.name,
      authorEmail: req.user.email,
      brand: brandDoc._id,
      brandName: brandDoc.name,
      quantity: quantity ? parseInt(quantity) : 1,
      location: location ? location.trim() : null
    });

    // Save to MongoDB
    const savedPost = await post.save();
    
    // Increment brand post count
    brandDoc.postCount += 1;
    await brandDoc.save();
    
    // Verify the post was saved by querying it back
    const verifiedPost = await Post.findById(savedPost._id);
    
    if (!verifiedPost) {
      throw new Error('Post was not saved to database');
    }

    console.log('✅ Post saved successfully!');
    console.log('Post ID:', savedPost._id);
    console.log('Post title:', savedPost.title);
    console.log('Post images:', savedPost.images.length);
    console.log('MongoDB Database:', savedPost.db?.databaseName || 'craft-hindustan');
    console.log('MongoDB Collection:', savedPost.collection?.collectionName || 'posts');
    console.log('Verified in DB:', !!verifiedPost);
    
    // Count total posts for this user
    const userPostCount = await Post.countDocuments({ author: req.user._id });
    console.log('Total posts by this user:', userPostCount);
    console.log('===========================');

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post: {
        _id: post._id,
        title: post.title,
        description: post.description,
        category: post.category,
        price: post.price,
        images: post.images,
        tags: post.tags,
        author: post.author,
        authorName: post.authorName,
        createdAt: post.createdAt
      }
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/posts
// @desc    Get all posts (with optional filters)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { category, author, brand, status, page = 1, limit = 20 } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }

    if (author) {
      query.author = author;
    }

    if (brand) {
      // Convert string ID to ObjectId for proper querying
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(brand)) {
        query.brand = new mongoose.Types.ObjectId(brand);
      } else {
        query.brand = brand;
      }
    }

    if (status) {
      query.status = status;
    } else {
      // Default to only published posts for public access
      query.status = 'published';
    }

    console.log('=== GET POSTS REQUEST ===');
    console.log('Query:', query);
    console.log('Brand ID (raw):', brand);
    console.log('Brand ID (converted):', query.brand);
    console.log('Page:', page, 'Limit:', limit);

    const posts = await Post.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('author', 'name email photoURL')
      .populate('brand', 'name picture')
      .exec();

    const total = await Post.countDocuments(query);

    console.log('Posts found:', posts.length);
    console.log('Total posts:', total);
    if (brand) {
      console.log('Posts for brand:', posts.map(p => ({ id: p._id, title: p.title, brand: p.brand, brandId: p.brand?._id || p.brand })));
      // Also check what posts exist in DB for this brand
      const allPostsForBrand = await Post.find({ brand: query.brand }).select('_id title status brand').exec();
      console.log('All posts in DB for this brand:', allPostsForBrand.map(p => ({ id: p._id, title: p.title, status: p.status, brand: p.brand })));
    }
    console.log('========================');

    res.json({
      success: true,
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/posts/user/my-posts
// @desc    Get current user's posts
// @access  Private
// NOTE: This route must come BEFORE /:id to avoid route conflicts
router.get('/user/my-posts', authenticateToken, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user._id })
      .sort({ createdAt: -1 })
      .populate('author', 'name email photoURL')
      .exec();

    res.json({
      success: true,
      posts
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/posts/:id
// @desc    Get a single post by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'name email photoURL')
      .exec();

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Increment views
    post.views += 1;
    await post.save();

    res.json({
      success: true,
      post
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   PUT /api/posts/:id
// @desc    Update a post
// @access  Private (only author)
router.put('/:id', authenticateToken, [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Description must be at least 10 characters long'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to update this post'
      });
    }

    // Update allowed fields
    const allowedUpdates = ['title', 'description', 'category', 'price', 'images', 'tags', 'status'];
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        post[field] = req.body[field];
      }
    });

    post.updatedAt = new Date();
    await post.save();

    res.json({
      success: true,
      message: 'Post updated successfully',
      post
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   DELETE /api/posts/:id
// @desc    Delete a post
// @access  Private (only author)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to delete this post'
      });
    }

    // Decrement brand post count if post has a brand
    if (post.brand) {
      const brandDoc = await Brand.findById(post.brand);
      if (brandDoc && brandDoc.postCount > 0) {
        brandDoc.postCount -= 1;
        await brandDoc.save();
      }
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

module.exports = router;

