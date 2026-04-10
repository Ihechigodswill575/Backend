// ==================== ADMIN ROUTES ====================
const router = require('express').Router();
const { getDashboard, getUsers, updateUser, getProducts, updateProductStatus, getOrders, updateOrderStatus, getCategories, createCategory, updateCategory, deleteCategory, createCoupon, getCoupons } = require('../controllers/admin.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken, requireRole('admin'));

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.put('/users/:id', updateUser);
router.get('/products', getProducts);
router.put('/products/:id/status', updateProductStatus);
router.get('/orders', getOrders);
router.put('/orders/:id/status', updateOrderStatus);
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);

module.exports = router;
