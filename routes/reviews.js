const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const profanity = require('leo-profanity');
const Review = require('../models/review');
const { ensureAuthenticated } = require('../config/auth');

// Initialize profanity filter
profanity.loadDictionary();

// Rate limiting: 3 reviews per hour per user
const reviewLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Too many reviews submitted. Please try again later.'
});

// Get approved reviews
router.get('/', async (req, res) => {
    try {
        const reviews = await Review.find({ status: 'approved' })
            .sort({ createdAt: -1 })
            .populate('userId', 'username')
            .limit(20);
        res.json(reviews);
    } catch (err) {
        console.error('Error fetching reviews:', err);
        res.status(500).json({ message: 'Error fetching reviews' });
    }
});

// Submit a new review
router.post('/', ensureAuthenticated, reviewLimiter, async (req, res) => {
    try {
        const { rating, comment } = req.body;

        // Validate input
        if (!rating || !comment || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Invalid review data' });
        }

        // Check for profanity
        if (profanity.check(comment)) {
            return res.status(400).json({ 
                message: 'Review contains inappropriate language' 
            });
        }

        // Create new review
        const review = new Review({
            userId: req.session.userId,
            rating,
            comment,
            status: 'approved' // Auto-approve for now (change to 'pending' if you want moderation)
        });

        await review.save();
        res.status(201).json({ 
            message: 'Review submitted successfully!' 
        });

    } catch (err) {
        console.error('Error submitting review:', err);
        res.status(500).json({ message: 'Error submitting review' });
    }
});

// Admin routes for moderation
router.get('/pending', ensureAuthenticated, async (req, res) => {
    // Check if user is admin (you'll need to implement this check based on your user system)
    if (!req.session.isAdmin) {
        return res.status(403).json({ message: 'Unauthorized' });
    }

    try {
        const pendingReviews = await Review.find({ status: 'pending' })
            .sort({ createdAt: 1 })
            .populate('userId', 'username');
        res.json(pendingReviews);
    } catch (err) {
        console.error('Error fetching pending reviews:', err);
        res.status(500).json({ message: 'Error fetching pending reviews' });
    }
});

// Approve or reject a review
router.patch('/:reviewId/moderate', ensureAuthenticated, async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(403).json({ message: 'Unauthorized' });
    }

    try {
        const { status } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const review = await Review.findByIdAndUpdate(
            req.params.reviewId,
            { status },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ message: 'Review not found' });
        }

        res.json({ message: 'Review moderated successfully', review });
    } catch (err) {
        console.error('Error moderating review:', err);
        res.status(500).json({ message: 'Error moderating review' });
    }
});

module.exports = router;
