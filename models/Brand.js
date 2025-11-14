const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Brand name is required'],
    trim: true,
    minlength: [2, 'Brand name must be at least 2 characters long'],
    maxlength: [100, 'Brand name cannot exceed 100 characters']
  },
  bio: {
    type: String,
    required: [true, 'Brand bio is required'],
    trim: true,
    minlength: [10, 'Bio must be at least 10 characters long'],
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },
  picture: {
    type: String,
    default: null
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ownerName: {
    type: String,
    required: true
  },
  ownerEmail: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  postCount: {
    type: Number,
    default: 0
  },
  establishedYear: {
    type: Number,
    required: false,
    min: [1900, 'Established year must be after 1900'],
    max: [new Date().getFullYear(), 'Established year cannot be in the future'],
    default: function() {
      // Default to the year the brand was created
      return this.createdAt ? new Date(this.createdAt).getFullYear() : new Date().getFullYear();
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for better query performance
brandSchema.index({ owner: 1, createdAt: -1 });
brandSchema.index({ name: 1 });
brandSchema.index({ status: 1 });

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;

