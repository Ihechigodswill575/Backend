// ==================== AUTH CONTROLLER ====================
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { auth, db } = require('../config/firebase');

function generateJWT(user) {
  return jwt.sign(
    { id: user.id, uid: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password, phone, role = 'buyer' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }
    if (!['buyer', 'seller'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Use "buyer" or "seller".' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    // Create Firebase Auth user
    let firebaseUser;
    try {
      firebaseUser = await auth().createUser({ email, password, displayName: name, phoneNumber: phone });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }
      throw err;
    }

    const uid = firebaseUser.uid;
    const passwordHash = await bcrypt.hash(password, 12);

    // Save user to Firestore
    const userData = {
      id: uid, name, email,
      phone: phone || null,
      role,
      status: 'active',
      passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db().collection('users').doc(uid).set(userData);

    // If seller, create a pending store document
    if (role === 'seller') {
      await db().collection('stores').doc(uid).set({
        id: uid,
        name: `${name}'s Store`,
        slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + uid.slice(0, 6),
        ownerId: uid,
        status: 'pending',
        products: 0,
        totalSales: 0,
        rating: 0,
        createdAt: new Date().toISOString(),
      });
    }

    // Set custom claims on Firebase Auth
    await auth().setCustomUserClaims(uid, { role });

    const token = generateJWT({ id: uid, email, role, name });

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully!`,
      token,
      user: { id: uid, name, email, role, phone },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: err.message || 'Registration failed.' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // Get user from Firestore
    const snap = await db().collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const userData = snap.docs[0].data();
    if (userData.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact support.' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, userData.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateJWT({ id: userData.id, email: userData.email, role: userData.role, name: userData.name });

    // Update last login
    await db().collection('users').doc(userData.id).update({ lastLoginAt: new Date().toISOString() });

    res.json({
      success: true,
      message: 'Signed in successfully!',
      token,
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        phone: userData.phone,
        photoURL: userData.photoURL,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
}

// GET /api/auth/me
async function getMe(req, res) {
  try {
    const userDoc = await db().collection('users').doc(req.user.id || req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const { passwordHash, ...user } = userDoc.data();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/auth/profile
async function updateProfile(req, res) {
  try {
    const uid = req.user.id || req.user.uid;
    const { name, phone, photoURL } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (photoURL) updates.photoURL = photoURL;
    updates.updatedAt = new Date().toISOString();

    await db().collection('users').doc(uid).update(updates);
    if (name) await auth().updateUser(uid, { displayName: name });

    res.json({ success: true, message: 'Profile updated.', updates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
    // Firebase handles the reset email
    const link = await auth().generatePasswordResetLink(email);
    // In production, send this link via your email service
    console.log('Password reset link:', link);
    res.json({ success: true, message: 'Password reset email sent. Check your inbox.' });
  } catch (err) {
    // Don't reveal if email exists or not
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  }
}

module.exports = { register, login, getMe, updateProfile, forgotPassword };
