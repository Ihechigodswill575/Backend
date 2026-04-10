// ==================== AUTH MIDDLEWARE ====================
const jwt = require('jsonwebtoken');
const { auth, db } = require('../config/firebase');

/**
 * Verify JWT token from Authorization header.
 * Supports both custom JWT and Firebase ID tokens.
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided. Please sign in.' });
    }

    const token = authHeader.split(' ')[1];

    // Try custom JWT first (faster)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (jwtErr) {
      // Fall through to Firebase token verification
    }

    // Try Firebase ID token
    try {
      const decodedFirebase = await auth().verifyIdToken(token);
      const userDoc = await db().collection('users').doc(decodedFirebase.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      req.user = {
        uid: decodedFirebase.uid,
        id: decodedFirebase.uid,
        email: decodedFirebase.email,
        role: userData.role || 'buyer',
        name: userData.name || decodedFirebase.displayName,
      };
      return next();
    } catch (fbErr) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token. Please sign in again.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Token verification failed.' });
  }
}

/**
 * Optional auth — attaches user if token present, continues either way.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      const decoded = await auth().verifyIdToken(token);
      const userDoc = await db().collection('users').doc(decoded.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      req.user = { uid: decoded.uid, id: decoded.uid, email: decoded.email, role: userData.role || 'buyer' };
    }
  } catch { /* continue without user */ }
  next();
}

/**
 * Role-based access control middleware factory.
 * Usage: requireRole('admin') or requireRole(['admin', 'seller'])
 */
function requireRole(...roles) {
  const allowedRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

module.exports = { verifyToken, optionalAuth, requireRole };
