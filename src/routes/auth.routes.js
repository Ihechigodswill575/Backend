// ==================== AUTH ROUTES ====================
const router = require('express').Router();
const { register, login, getMe, updateProfile, forgotPassword } = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.get('/me', verifyToken, getMe);
router.put('/profile', verifyToken, updateProfile);

module.exports = router;
