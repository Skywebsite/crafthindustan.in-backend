const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Brand = require('../models/Brand');

// Middleware to authenticate and check if user is admin
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user is admin
    // Option 1: Check by email (set ADMIN_EMAILS in .env)
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase()) : [];
    
    // Option 2: Default admin email
    const defaultAdminEmail = 'admin@crafthindustan.com';
    
    if (!adminEmails.includes(user.email.toLowerCase()) && user.email.toLowerCase() !== defaultAdminEmail) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required. Contact administrator for access.'
      });
    }

    req.admin = user;
    req.user = user; // For consistency with other routes
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// @route   GET /api/admin/stats
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    // Total counts
    const totalUsers = await User.countDocuments();
    const totalProducts = await Post.countDocuments();
    const totalBrands = await Brand.countDocuments();
    const publishedProducts = await Post.countDocuments({ status: 'published' });
    const draftProducts = await Post.countDocuments({ status: 'draft' });
    const soldProducts = await Post.countDocuments({ status: 'sold' });

    // Products by category
    const productsByCategory = await Post.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$price' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Products by brand
    const productsByBrand = await Post.aggregate([
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brandInfo'
        }
      },
      {
        $unwind: {
          path: '$brandInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$brand',
          brandName: { $first: '$brandInfo.name' },
          count: { $sum: 1 },
          totalRevenue: { $sum: '$price' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Users by registration date (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const newUsersLast30Days = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Products created in last 30 days
    const newProductsLast30Days = await Post.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Top selling categories
    const topCategories = productsByCategory.slice(0, 5).map(item => ({
      name: item._id,
      count: item.count,
      revenue: item.totalRevenue
    }));

    // Top brands
    const topBrands = productsByBrand.slice(0, 5).map(item => ({
      brandId: item._id,
      brandName: item.brandName || 'Unknown',
      count: item.count,
      revenue: item.totalRevenue
    }));

    // Total revenue
    const totalRevenue = await Post.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$price' }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        overview: {
          totalUsers,
          totalProducts,
          totalBrands,
          publishedProducts,
          draftProducts,
          soldProducts,
          newUsersLast30Days,
          newProductsLast30Days,
          totalRevenue: totalRevenue[0]?.total || 0
        },
        productsByCategory: productsByCategory.map(item => ({
          name: item._id,
          value: item.count,
          revenue: item.totalRevenue
        })),
        productsByBrand: productsByBrand.map(item => ({
          name: item.brandName || 'Unknown',
          value: item.count,
          revenue: item.totalRevenue,
          brandId: item._id
        })),
        topCategories,
        topBrands
      }
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Private (Admin only)
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();

    const total = await User.countDocuments();

    res.json({
      success: true,
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/admin/products
// @desc    Get all products with filters
// @access  Private (Admin only)
router.get('/products', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { category, status, brand } = req.query;

    const query = {};
    if (category) query.category = category;
    if (status) query.status = status;
    if (brand) query.brand = brand;

    const products = await Post.find(query)
      .populate('author', 'name email')
      .populate('brand', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();

    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get admin products error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// @route   GET /api/admin/brands
// @desc    Get all brands with pagination
// @access  Private (Admin only)
router.get('/brands', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const brands = await Brand.find()
      .populate('owner', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();

    const total = await Brand.countDocuments();

    res.json({
      success: true,
      brands,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get admin brands error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

module.exports = router;

