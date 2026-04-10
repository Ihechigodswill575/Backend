// ==================== CART CONTROLLER ====================
const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

// GET /api/cart
async function getCart(req, res) {
  try {
    const userId = req.user.id || req.user.uid;
    const cartDoc = await db().collection('carts').doc(userId).get();
    if (!cartDoc.exists) return res.json({ success: true, data: { items: [], total: 0 } });
    const cart = cartDoc.data();
    const total = (cart.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
    res.json({ success: true, data: { ...cart, total } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/cart/add
async function addToCart(req, res) {
  try {
    const userId = req.user.id || req.user.uid;
    const { productId, quantity = 1 } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: 'Product ID required.' });

    const productSnap = await db().collection('products').doc(productId).get();
    if (!productSnap.exists || productSnap.data().status !== 'approved') {
      return res.status(404).json({ success: false, message: 'Product not available.' });
    }
    const product = productSnap.data();
    if (product.stock < quantity) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} units available.` });
    }

    const cartRef = db().collection('carts').doc(userId);
    const cartDoc = await cartRef.get();
    let items = cartDoc.exists ? cartDoc.data().items || [] : [];

    const existing = items.find(i => i.productId === productId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, product.stock);
    } else {
      items.push({ cartItemId: uuidv4(), productId, name: product.name, price: product.price, image: product.images?.[0] || '', sellerId: product.sellerId, quantity });
    }

    await cartRef.set({ userId, items, updatedAt: new Date().toISOString() });
    res.json({ success: true, message: `${product.name} added to cart!`, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/cart/update
async function updateCartItem(req, res) {
  try {
    const userId = req.user.id || req.user.uid;
    const { cartItemId, quantity } = req.body;
    if (!cartItemId || quantity == null) return res.status(400).json({ success: false, message: 'cartItemId and quantity required.' });

    const cartRef = db().collection('carts').doc(userId);
    const cartDoc = await cartRef.get();
    if (!cartDoc.exists) return res.status(404).json({ success: false, message: 'Cart not found.' });

    let items = cartDoc.data().items || [];
    if (quantity <= 0) {
      items = items.filter(i => i.cartItemId !== cartItemId);
    } else {
      const item = items.find(i => i.cartItemId === cartItemId);
      if (item) item.quantity = quantity;
    }

    await cartRef.update({ items, updatedAt: new Date().toISOString() });
    res.json({ success: true, message: 'Cart updated.', data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/cart/remove
async function removeFromCart(req, res) {
  try {
    const userId = req.user.id || req.user.uid;
    const { cartItemId } = req.body;
    const cartRef = db().collection('carts').doc(userId);
    const cartDoc = await cartRef.get();
    if (!cartDoc.exists) return res.status(404).json({ success: false, message: 'Cart not found.' });

    const items = (cartDoc.data().items || []).filter(i => i.cartItemId !== cartItemId);
    await cartRef.update({ items, updatedAt: new Date().toISOString() });
    res.json({ success: true, message: 'Item removed.', data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/cart/clear
async function clearCart(req, res) {
  try {
    const userId = req.user.id || req.user.uid;
    await db().collection('carts').doc(userId).set({ userId, items: [], updatedAt: new Date().toISOString() });
    res.json({ success: true, message: 'Cart cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getCart, addToCart, updateCartItem, removeFromCart, clearCart };
