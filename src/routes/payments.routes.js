// ==================== PAYMENTS ROUTES ====================
const router = require('express').Router();
const {
  paystackInitialize, paystackVerify, paystackWebhook,
  flutterwaveInitialize, flutterwaveWebhook,
  getBanks, verifyAccount,
} = require('../controllers/payments.controller');
const { verifyToken } = require('../middleware/auth');

// Webhooks — raw body, verified by HMAC signature inside controller
// These must NOT have verifyToken applied
router.post('/paystack/webhook', paystackWebhook);
router.post('/flutterwave/webhook', flutterwaveWebhook);

// Protected payment endpoints
router.post('/paystack/initialize', verifyToken, paystackInitialize);
router.get('/paystack/verify/:reference', verifyToken, paystackVerify);
router.post('/paystack/verify/:reference', verifyToken, paystackVerify); // support both methods
router.post('/flutterwave/initialize', verifyToken, flutterwaveInitialize);
router.get('/banks', verifyToken, getBanks);
router.post('/verify-account', verifyToken, verifyAccount);

module.exports = router;
