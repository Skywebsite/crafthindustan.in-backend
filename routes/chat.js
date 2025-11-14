const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Post = require('../models/Post');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

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
      error: 'Token verification failed',
      message: error.message
    });
  }
};

router.post('/conversations', authenticateToken, async (req, res) => {
  try {
    const { participantId, postId } = req.body;

    if (!participantId || !mongoose.Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({
        success: false,
        error: 'Valid participantId is required'
      });
    }

    if (participantId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot start a conversation with yourself'
      });
    }

    const participant = await User.findById(participantId).select('name email photoURL');
    if (!participant) {
      return res.status(404).json({
        success: false,
        error: 'Artist not found'
      });
    }

    let relatedPost = null;
    if (postId && mongoose.Types.ObjectId.isValid(postId)) {
      const postExists = await Post.findById(postId).select('_id');
      if (postExists) {
        relatedPost = postExists._id;
      }
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, participantId] }
    })
      .populate('participants', 'name email photoURL')
      .populate('post', 'title images author authorName');

    if (!conversation) {
      const conversationData = {
        participants: [req.user._id, participantId],
        post: relatedPost
      };
      conversation = await Conversation.create(conversationData);
      conversation = await conversation.populate('participants', 'name email photoURL');
      conversation = await conversation.populate('post', 'title images author authorName');
    } else if (relatedPost && !conversation.post) {
      conversation.post = relatedPost;
      await conversation.save();
    }

    res.json({
      success: true,
      conversation
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create conversation',
      message: error.message
    });
  }
});

router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id
    })
      .sort({ updatedAt: -1 })
      .populate('participants', 'name email photoURL')
      .populate('post', 'title images author authorName');

    res.json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load conversations',
      message: error.message
    });
  }
});

router.get('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid conversation ID'
      });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    const isParticipant = conversation.participants.some(
      (participant) => participant.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'You are not part of this conversation'
      });
    }

    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .populate('sender', 'name email photoURL');

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load messages',
      message: error.message
    });
  }
});

router.post('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid conversation ID'
      });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    const isParticipant = conversation.participants.some(
      (participant) => participant.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'You are not part of this conversation'
      });
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      content: content.trim(),
      readBy: [req.user._id]
    });

    conversation.lastMessage = {
      content: content.trim(),
      sender: req.user._id,
      createdAt: message.createdAt
    };
    await conversation.save();

    const populatedMessage = await message.populate('sender', 'name email photoURL');
    const io = req.app.get('io');
    if (io) {
      io.to(conversationId.toString()).emit('message:new', {
        conversationId: conversationId.toString(),
        message: populatedMessage
      });
      io.to(conversationId.toString()).emit('conversation:update', {
        conversationId: conversationId.toString(),
        lastMessage: conversation.lastMessage,
        updatedAt: conversation.updatedAt
      });
    }

    res.status(201).json({
      success: true,
      message: populatedMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      message: error.message
    });
  }
});

module.exports = router;


