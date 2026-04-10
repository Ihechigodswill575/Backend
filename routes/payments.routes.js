// ==================== PAYMENTS ROUTES ====================
const router = require('express').Router();
const { paystackInitialize, paystackVerify, paystackWebhook, flutterwaveInitialize, flutterwaveWebhook, getBanks, verifyAccount } = require('../controllers/payments.controller');
const { verifyToken } = require('../middleware/auth');

// Webhooks — no auth (verified by HMAC signature inside controller)
router.post('/paystack/webhook', paystackWebhook);
router.post('/flutterwave/webhook', flutterwaveWebhook);

// Protected
router.post('/paystack/initialize', verifyToken, paystackInitialize);
router.post('/paystack/verify/:reference', verifyToken, paystackVerify);
router.post('/flutterwave/initialize', verifyToken, flutterwaveInitialize);
router.get('/banks', verifyToken, getBanks);
router.post('/verify-account', verifyToken, verifyAccount);

module.exports = router;
