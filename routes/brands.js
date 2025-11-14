const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const cloudinary = require('../config/cloudinary');
const Brand = require('../models/Brand');
const User = require('../models/User');
const Post = require('../models/Post');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
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
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please log in again.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Token verification failed'
    });
  }
};

// Helper function to upload image to Cloudinary
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'craft-hindustan/brands',
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
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
        error: 'File size too large. Maximum size is 5MB'
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

// @route   POST /api/brands
// @desc    Create a new brand
// @access  Private
router.post('/', authenticateToken, (req, res, next) => {
  upload.single('picture')(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    next();
  });
}, [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Brand name must be between 2 and 100 characters'),
  body('bio')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Bio must be between 10 and 500 characters'),
  body('establishedYear')
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() })
    .withMessage('Established year must be between 1900 and current year')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, bio, establishedYear } = req.body;

    // Check if user already has a brand (only 1 brand allowed per user)
    const existingBrand = await Brand.findOne({ 
      owner: req.user._id
    });

    if (existingBrand) {
      return res.status(400).json({
        success: false,
        error: 'You already have a brand. You can only have one brand. Please edit your existing brand instead.'
      });
    }

    let pictureUrl = null;
    if (req.file) {
      pictureUrl = await uploadToCloudinary(req.file.buffer);
    }

    const brand = new Brand({
      name: name.trim(),
      bio: bio.trim(),
      picture: pictureUrl,
      establishedYear: parseInt(establishedYear),
      owner: req.user._id,
      ownerName: req.user.name,
      ownerEmail: req.user.email
    });

    await brand.save();

    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      brand
    });
  } catch (error) {
    console.error('Create brand error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/brands
// @desc    Get all brands (public)
// @access  Public
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/brands - Fetching all brands');
    const { page = 1, limit = 20, status = 'active' } = req.query;
    const query = { status };
    console.log('Query params:', { page, limit, status });

    const brands = await Brand.find(query)
      .populate('owner', 'name email photoURL')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    // Recalculate postCount and set default establishedYear for each brand
    const Post = require('../models/Post');
    for (let brand of brands) {
      const brandId = brand._id;
      const publishedPostCount = await Post.countDocuments({ brand: brandId, status: 'published' });
      const totalPostCount = await Post.countDocuments({ brand: brandId });
      let needsSave = false;
      
      // Set default establishedYear if missing (for existing brands)
      if (!brand.establishedYear || brand.establishedYear === null || brand.establishedYear === undefined) {
        const yearFromCreated = brand.createdAt ? new Date(brand.createdAt).getFullYear() : new Date().getFullYear();
        console.log(`Brands list - Setting establishedYear for brand ${brandId}: ${yearFromCreated}`);
        brand.establishedYear = yearFromCreated;
        brand.markModified('establishedYear');
        needsSave = true;
      }
      
      // Update postCount to published count (for display consistency)
      if (brand.postCount !== publishedPostCount) {
        console.log(`Brands list - Updating postCount for brand ${brandId}: ${brand.postCount} -> ${publishedPostCount} (Total: ${totalPostCount})`);
        brand.postCount = publishedPostCount;
        brand.markModified('postCount');
        needsSave = true;
      }
      
      // Save if any updates were made
      if (needsSave) {
        await brand.save();
        console.log(`Brands list - Saved brand ${brandId} - establishedYear: ${brand.establishedYear}, postCount: ${brand.postCount}`);
      }
    }
    
    // Reload all brands to get updated values
    const updatedBrands = await Brand.find(query)
      .populate('owner', 'name email photoURL')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Brand.countDocuments(query);

    console.log(`Found ${updatedBrands.length} brands out of ${total} total`);

    res.json({
      success: true,
      brands: updatedBrands,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/brands/my-brands
// @desc    Get current user's brand (only 1 brand allowed)
// @access  Private
router.get('/my-brands', authenticateToken, async (req, res) => {
  try {
    const brand = await Brand.findOne({ owner: req.user._id }).exec();

    if (brand) {
      // Recalculate postCount to ensure accuracy
      const Post = require('../models/Post');
      const brandId = brand._id;
      const publishedPostCount = await Post.countDocuments({ brand: brandId, status: 'published' });
      const totalPostCount = await Post.countDocuments({ brand: brandId });
      let needsSave = false;
      
      // Set default establishedYear if missing (for existing brands)
      if (!brand.establishedYear || brand.establishedYear === null || brand.establishedYear === undefined) {
        const yearFromCreated = brand.createdAt ? new Date(brand.createdAt).getFullYear() : new Date().getFullYear();
        console.log(`My brands - Setting establishedYear for brand ${brandId}: ${yearFromCreated}`);
        brand.establishedYear = yearFromCreated;
        brand.markModified('establishedYear');
        needsSave = true;
      }
      
      // Update postCount to published count (for display consistency)
      if (brand.postCount !== publishedPostCount) {
        console.log(`My brands - Updating postCount for brand ${brandId}: ${brand.postCount} -> ${publishedPostCount} (Total: ${totalPostCount})`);
        brand.postCount = publishedPostCount;
        brand.markModified('postCount');
        needsSave = true;
      }
      
      // Save if any updates were made
      if (needsSave) {
        await brand.save();
        console.log(`My brands - Saved brand ${brandId} - establishedYear: ${brand.establishedYear}, postCount: ${brand.postCount}`);
      }
      
      // Reload brand to get updated values
      const updatedBrand = await Brand.findOne({ owner: req.user._id })
        .populate('owner', 'name email photoURL')
        .exec();
      
      return res.json({
        success: true,
        brand: updatedBrand || null,
        brands: updatedBrand ? [updatedBrand] : [] // Keep for backward compatibility
      });
    }

    res.json({
      success: true,
      brand: null,
      brands: [] // Keep for backward compatibility
    });
  } catch (error) {
    console.error('Get user brand error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/brands/:id
// @desc    Get a single brand by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id)
      .populate('owner', 'name email photoURL')
      .exec();

    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }

    // Recalculate postCount to ensure accuracy
    const Post = require('../models/Post');
    const mongoose = require('mongoose');
    
    // Count all posts for this brand (including unpublished for accurate count)
    // Try both ObjectId and string format to ensure we find all posts
    const brandId = brand._id;
    const totalPostCount = await Post.countDocuments({ brand: brandId });
    // Count only published posts (for display)
    const publishedPostCount = await Post.countDocuments({ 
      brand: brandId, 
      status: 'published' 
    });
    
    // Also check what posts actually exist
    const actualPosts = await Post.find({ brand: brandId }).select('_id title status brand').limit(5).exec();
    console.log(`Actual posts in DB for brand ${brandId}:`, actualPosts.map(p => ({ id: p._id, title: p.title, status: p.status })));
    
    console.log(`Brand ${brand._id} - Total posts: ${totalPostCount}, Published: ${publishedPostCount}, Current postCount: ${brand.postCount}`);
    
    let needsSave = false;
    
    // Set default establishedYear if missing (for existing brands)
    if (!brand.establishedYear || brand.establishedYear === null || brand.establishedYear === undefined) {
      const yearFromCreated = brand.createdAt ? new Date(brand.createdAt).getFullYear() : new Date().getFullYear();
      console.log(`Brand ${brand._id} - Missing establishedYear. Setting to: ${yearFromCreated} (createdAt: ${brand.createdAt})`);
      brand.establishedYear = yearFromCreated;
      brand.markModified('establishedYear');
      needsSave = true;
    } else {
      console.log(`Brand ${brand._id} - establishedYear already set: ${brand.establishedYear}`);
    }
    
    // Update postCount to published count (for display consistency)
    if (brand.postCount !== publishedPostCount) {
      console.log(`Updating postCount for brand ${brand._id}: ${brand.postCount} -> ${publishedPostCount} (Total posts: ${totalPostCount})`);
      brand.postCount = publishedPostCount;
      brand.markModified('postCount');
      needsSave = true;
    }
    
    // Save if any updates were made
    if (needsSave) {
      await brand.save();
      console.log(`Saved brand ${brand._id} - establishedYear: ${brand.establishedYear}, postCount: ${brand.postCount}`);
    }
    
    // Always reload brand to ensure we have the latest data
    const finalBrand = await Brand.findById(brand._id)
      .populate('owner', 'name email photoURL')
      .exec();
    
    console.log(`Returning brand ${finalBrand._id} - establishedYear: ${finalBrand.establishedYear}, postCount: ${finalBrand.postCount}`);

    res.json({
      success: true,
      brand: finalBrand
    });
  } catch (error) {
    console.error('Get brand error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   PUT /api/brands/:id
// @desc    Update a brand
// @access  Private (only owner)
router.put('/:id', authenticateToken, (req, res, next) => {
  upload.single('picture')(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    next();
  });
}, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Brand name must be between 2 and 100 characters'),
  body('bio')
    .optional()
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Bio must be between 10 and 500 characters'),
  body('establishedYear')
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() })
    .withMessage('Established year must be between 1900 and current year')
], async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'Brand not found'
      });
    }

    // Check if user owns this brand
    if (brand.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to update this brand'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, bio, establishedYear } = req.body;

    if (name) {
      // Check if name already exists for this user (excluding current brand)
      const existingBrand = await Brand.findOne({ 
        owner: req.user._id, 
        name: name.trim(),
        _id: { $ne: req.params.id }
      });

      if (existingBrand) {
        return res.status(400).json({
          success: false,
          error: 'You already have a brand with this name'
        });
      }

      brand.name = name.trim();
    }

    if (bio) {
      brand.bio = bio.trim();
    }

    if (establishedYear) {
      brand.establishedYear = parseInt(establishedYear);
    }

    if (req.file) {
      brand.picture = await uploadToCloudinary(req.file.buffer);
    }

    await brand.save();

    res.json({
      success: true,
      message: 'Brand updated successfully',
      brand
    });
  } catch (error) {
    console.error('Update brand error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

module.exports = router;

