// ==================== ORDERS ROUTES ====================
const router = require('express').Router();
const { placeOrder, getBuyerOrders, getOrder, cancelOrder } = require('../controllers/orders.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.post('/', placeOrder);
router.get('/', getBuyerOrders);
router.get('/:id', getOrder);
router.post('/:id/cancel', cancelOrder);

module.exports = router;
