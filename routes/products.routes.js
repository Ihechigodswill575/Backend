// ==================== PRODUCTS ROUTES ====================
const router = require('express').Router();
const { getProducts, getFeatured, getProduct, getCategories, addReview, getReviews } = require('../controllers/products.controller');
const { verifyToken, optionalAuth } = require('../middleware/auth');

router.get('/', getProducts);
router.get('/featured', getFeatured);
router.get('/categories', getCategories);
router.get('/:slug/reviews', getReviews);
router.post('/:id/reviews', verifyToken, addReview);
router.get('/:slug', getProduct);

module.exports = router;
