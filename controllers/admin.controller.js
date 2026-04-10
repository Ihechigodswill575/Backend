// ==================== ADMIN CONTROLLER ====================
const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

// GET /api/admin/dashboard
async function getDashboard(req, res) {
  try {
    const [usersSnap, ordersSnap, productsSnap] = await Promise.all([
      db().collection('users').get(),
      db().collection('orders').get(),
      db().collection('products').where('status', '==', 'approved').get(),
    ]);

    const users = usersSnap.docs.map(d => d.data());
    const orders = ordersSnap.docs.map(d => d.data());
    const products = productsSnap.docs.map(d => d.data());

    const gmv = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0);
    const revenue = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + (o.commission || 0), 0);
    const pendingOrders = orders.filter(o => o.orderStatus === 'pending').length;
    const activeSellers = users.filter(u => u.role === 'seller' && u.status === 'active').length;

    // 7-day orders chart
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = orders.filter(o => o.createdAt?.startsWith(dateStr)).length;
      last7.push({ date: dateStr, orders: count });
    }

    res.json({
      success: true,
      data: {
        gmv, revenue, pendingOrders, activeSellers,
        totalUsers: users.length,
        totalBuyers: users.filter(u => u.role === 'buyer').length,
        totalSellers: users.filter(u => u.role === 'seller').length,
        totalProducts: products.length,
        totalOrders: orders.length,
        ordersChart: last7,
        orderStatusBreakdown: {
          pending: orders.filter(o => o.orderStatus === 'pending').length,
          processing: orders.filter(o => o.orderStatus === 'processing').length,
          shipped: orders.filter(o => o.orderStatus === 'shipped').length,
          delivered: orders.filter(o => o.orderStatus === 'delivered').length,
          cancelled: orders.filter(o => o.orderStatus === 'cancelled').length,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/admin/users
async function getUsers(req, res) {
  try {
    const { role, status, q } = req.query;
    let ref = db().collection('users');
    if (role) ref = ref.where('role', '==', role);
    if (status) ref = ref.where('status', '==', status);
    const snap = await ref.orderBy('createdAt', 'desc').get();
    let users = snap.docs.map(d => {
      const { passwordHash, ...u } = d.data();
      return { id: d.id, ...u };
    });
    if (q) {
      const search = q.toLowerCase();
      users = users.filter(u => u.name?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search));
    }
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/admin/users/:id
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { status, role } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (status) updates.status = status;
    if (role) updates.role = role;
    await db().collection('users').doc(id).update(updates);
    res.json({ success: true, message: 'User updated.', data: updates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/admin/products
async function getProducts(req, res) {
  try {
    const { status, sellerId, category } = req.query;
    let ref = db().collection('products');
    if (status) ref = ref.where('status', '==', status);
    if (sellerId) ref = ref.where('sellerId', '==', sellerId);
    if (category) ref = ref.where('category', '==', category);
    const snap = await ref.orderBy('createdAt', 'desc').get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/admin/products/:id/status
async function updateProductStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    if (!['approved', 'rejected', 'pending', 'out_of_stock'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }
    await db().collection('products').doc(id).update({
      status, rejectionReason: reason || null, updatedAt: new Date().toISOString(),
      ...(status === 'approved' && { approvedAt: new Date().toISOString() }),
    });
    res.json({ success: true, message: `Product ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/admin/orders
async function getOrders(req, res) {
  try {
    const { status, paymentMethod, sellerId, buyerId } = req.query;
    let ref = db().collection('orders');
    if (status) ref = ref.where('orderStatus', '==', status);
    if (paymentMethod) ref = ref.where('paymentMethod', '==', paymentMethod);
    const snap = await ref.orderBy('createdAt', 'desc').get();
    let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (sellerId) orders = orders.filter(o => o.sellerIds?.includes(sellerId));
    if (buyerId) orders = orders.filter(o => o.buyerId === buyerId);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/admin/orders/:id/status
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await db().collection('orders').doc(id).update({
      orderStatus: status, updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, message: `Order status updated to "${status}".` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/admin/categories
async function getCategories(req, res) {
  try {
    const snap = await db().collection('categories').orderBy('sortOrder', 'asc').get();
    res.json({ success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/admin/categories
async function createCategory(req, res) {
  try {
    const { name, icon, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name required.' });
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const data = { id, name, slug: id, icon: icon || '📦', description: description || '', active: true, productCount: 0, sortOrder: 99, createdAt: new Date().toISOString() };
    await db().collection('categories').doc(id).set(data);
    res.status(201).json({ success: true, message: 'Category created.', data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/admin/categories/:id
async function updateCategory(req, res) {
  try {
    const { name, icon, description, active, sortOrder } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (icon) updates.icon = icon;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = active;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    await db().collection('categories').doc(req.params.id).update(updates);
    res.json({ success: true, message: 'Category updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// DELETE /api/admin/categories/:id
async function deleteCategory(req, res) {
  try {
    await db().collection('categories').doc(req.params.id).delete();
    res.json({ success: true, message: 'Category deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/admin/coupons
async function createCoupon(req, res) {
  try {
    const { code, type, value, minOrder = 0, maxUses = 1000, expiresAt } = req.body;
    if (!code || !type || !value) return res.status(400).json({ success: false, message: 'Code, type, and value required.' });
    const id = uuidv4();
    const data = {
      id, code: code.toUpperCase(), type, value: parseFloat(value),
      minOrder: parseFloat(minOrder), maxUses: parseInt(maxUses), usedCount: 0,
      expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      active: true, createdAt: new Date().toISOString(),
    };
    await db().collection('coupons').doc(id).set(data);
    res.status(201).json({ success: true, message: 'Coupon created.', data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/admin/coupons
async function getCoupons(req, res) {
  try {
    const snap = await db().collection('coupons').orderBy('createdAt', 'desc').get();
    res.json({ success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getDashboard, getUsers, updateUser, getProducts, updateProductStatus, getOrders, updateOrderStatus, getCategories, createCategory, updateCategory, deleteCategory, createCoupon, getCoupons };
