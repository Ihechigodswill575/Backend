// ==================== SELLER ROUTES ====================
const router = require('express').Router();
const { getDashboard, getSellerProducts, createProduct, updateProduct, deleteProduct, getSellerOrders, updateOrderStatus, verifyBankAccount, getStore, updateStore } = require('../controllers/seller.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

// All seller routes require auth + seller role
router.use(verifyToken, requireRole('seller', 'admin'));

router.get('/dashboard', getDashboard);
router.get('/products', getSellerProducts);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.get('/orders', getSellerOrders);
router.put('/orders/:id/status', updateOrderStatus);
router.post('/bank/verify', verifyBankAccount);
router.get('/store', getStore);
router.put('/store', updateStore);

module.exports = router;
