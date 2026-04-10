// ==================== SELLER CONTROLLER ====================
const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/seller/dashboard
async function getDashboard(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const [ordersSnap, productsSnap] = await Promise.all([
      db().collection('orders').where('sellerIds', 'array-contains', sellerId).get(),
      db().collection('products').where('sellerId', '==', sellerId).get(),
    ]);
    const orders = ordersSnap.docs.map(d => d.data());
    const products = productsSnap.docs.map(d => d.data());

    const totalRevenue = orders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.subtotal, 0);
    const pendingOrders = orders.filter(o => o.orderStatus === 'pending').length;
    const processingOrders = orders.filter(o => o.orderStatus === 'processing').length;
    const deliveredOrders = orders.filter(o => o.orderStatus === 'delivered').length;

    res.json({
      success: true,
      data: {
        totalRevenue, pendingOrders, processingOrders, deliveredOrders,
        totalOrders: orders.length,
        totalProducts: products.length,
        approvedProducts: products.filter(p => p.status === 'approved').length,
        pendingProducts: products.filter(p => p.status === 'pending').length,
        lowStockProducts: products.filter(p => p.stock <= 5 && p.stock > 0),
        recentOrders: orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/seller/products
async function getSellerProducts(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { status, category, q } = req.query;
    let ref = db().collection('products').where('sellerId', '==', sellerId);
    if (status) ref = ref.where('status', '==', status);
    if (category) ref = ref.where('category', '==', category);
    const snap = await ref.orderBy('createdAt', 'desc').get();
    let products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (q) {
      const search = q.toLowerCase();
      products = products.filter(p => p.name?.toLowerCase().includes(search));
    }
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/seller/products
async function createProduct(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { name, description, price, oldPrice, stock, sku, categoryId, images = [], badge, tags = [], featured = false } = req.body;

    if (!name || !price || !stock || !categoryId) {
      return res.status(400).json({ success: false, message: 'Name, price, stock, and category are required.' });
    }
    if (parseFloat(price) <= 0) return res.status(400).json({ success: false, message: 'Price must be greater than 0.' });

    // Get seller info
    const userSnap = await db().collection('users').doc(sellerId).get();
    const userData = userSnap.data();
    const storeSnap = await db().collection('stores').doc(sellerId).get();
    const storeData = storeSnap.exists ? storeSnap.data() : {};

    const productId = uuidv4();
    const slug = slugify(name) + '-' + Math.floor(price);
    const productData = {
      id: productId, name, slug,
      description: description || '',
      price: parseFloat(price),
      oldPrice: oldPrice ? parseFloat(oldPrice) : null,
      stock: parseInt(stock),
      sku: sku || `SKU-${productId.slice(0, 8).toUpperCase()}`,
      categoryId, category: categoryId,
      images, badge: badge || null, tags, featured,
      sellerId, sellerName: storeData.name || userData?.name || 'Unknown Seller',
      status: 'pending', // Admin must approve
      rating: 0, reviewCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db().collection('products').doc(productId).set(productData);
    // Increment store product count
    await db().collection('stores').doc(sellerId).update({ products: require('firebase-admin').firestore.FieldValue.increment(1) });

    res.status(201).json({ success: true, message: 'Product submitted for review. It will go live once approved by admin.', data: productData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/seller/products/:id
async function updateProduct(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { id } = req.params;
    const snap = await db().collection('products').doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (snap.data().sellerId !== sellerId) return res.status(403).json({ success: false, message: 'You do not own this product.' });

    const { name, description, price, oldPrice, stock, images, badge, tags, featured } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name) { updates.name = name; updates.slug = slugify(name) + '-' + (price || snap.data().price); }
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = parseFloat(price);
    if (oldPrice !== undefined) updates.oldPrice = parseFloat(oldPrice) || null;
    if (stock !== undefined) updates.stock = parseInt(stock);
    if (images) updates.images = images;
    if (badge !== undefined) updates.badge = badge;
    if (tags) updates.tags = tags;
    if (featured !== undefined) updates.featured = featured;
    // Re-submit for approval if price or name changed
    if (name || price) updates.status = 'pending';

    await db().collection('products').doc(id).update(updates);
    res.json({ success: true, message: 'Product updated.', data: { id, ...snap.data(), ...updates } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/seller/products/:id
async function deleteProduct(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { id } = req.params;
    const snap = await db().collection('products').doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Product not found.' });
    if (snap.data().sellerId !== sellerId) return res.status(403).json({ success: false, message: 'You do not own this product.' });
    await db().collection('products').doc(id).delete();
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/seller/orders
async function getSellerOrders(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { status } = req.query;
    let ref = db().collection('orders').where('sellerIds', 'array-contains', sellerId);
    const snap = await ref.orderBy('createdAt', 'desc').get();
    let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (status) orders = orders.filter(o => o.orderStatus === status);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/seller/orders/:id/status
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['confirmed', 'processing', 'shipped', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }
    const snap = await db().collection('orders').doc(id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = snap.data();
    const sellerId = req.user.id || req.user.uid;
    if (!order.sellerIds?.includes(sellerId)) return res.status(403).json({ success: false, message: 'Not your order.' });

    const updates = { orderStatus: status, updatedAt: new Date().toISOString() };
    if (status === 'delivered') updates.paymentStatus = order.paymentMethod === 'cod' ? 'paid' : order.paymentStatus;
    await db().collection('orders').doc(id).update(updates);
    res.json({ success: true, message: `Order status updated to "${status}".` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/seller/bank/verify
async function verifyBankAccount(req, res) {
  try {
    const { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ success: false, message: 'Account number and bank code are required.' });
    }
    const resp = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const { account_name, account_number } = resp.data.data;
    res.json({ success: true, message: 'Account verified.', data: { accountName: account_name, accountNumber: account_number } });
  } catch (err) {
    const msg = err.response?.data?.message || 'Bank account verification failed.';
    res.status(400).json({ success: false, message: msg });
  }
}

// GET /api/seller/store
async function getStore(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const snap = await db().collection('stores').doc(sellerId).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Store not found.' });
    res.json({ success: true, data: { id: snap.id, ...snap.data() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/seller/store
async function updateStore(req, res) {
  try {
    const sellerId = req.user.id || req.user.uid;
    const { name, description, phone, address, logoURL, bannerURL } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (phone) updates.phone = phone;
    if (address) updates.address = address;
    if (logoURL) updates.logoURL = logoURL;
    if (bannerURL) updates.bannerURL = bannerURL;
    await db().collection('stores').doc(sellerId).update(updates);
    res.json({ success: true, message: 'Store updated.', data: updates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getDashboard, getSellerProducts, createProduct, updateProduct, deleteProduct, getSellerOrders, updateOrderStatus, verifyBankAccount, getStore, updateStore };
