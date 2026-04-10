// ==================== ORDERS CONTROLLER ====================
const { db } = require('../config/firebase');

const COMMISSION_RATE = parseFloat(process.env.TAVIKMART_COMMISSION_RATE || '5') / 100;
const SHIPPING_RATES = { standard: 1500, express: 3500 };

function generateOrderId() {
  return 'TVM-' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// POST /api/orders — place new order
async function placeOrder(req, res) {
  try {
    const buyerId = req.user.id || req.user.uid;
    const { items, shippingAddress, paymentMethod = 'cod', shippingType = 'standard', couponCode } = req.body;

    if (!items?.length) return res.status(400).json({ success: false, message: 'Cart is empty.' });
    if (!shippingAddress?.address) return res.status(400).json({ success: false, message: 'Shipping address required.' });

    // Validate payment method
    if (!['cod', 'paystack', 'flutterwave'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Invalid payment method.' });
    }

    // Verify products & stock
    const enrichedItems = [];
    let subtotal = 0;
    for (const item of items) {
      const productSnap = await db().collection('products').doc(item.productId).get();
      if (!productSnap.exists) return res.status(404).json({ success: false, message: `Product ${item.productId} not found.` });
      const product = productSnap.data();
      if (product.status !== 'approved') return res.status(400).json({ success: false, message: `Product "${product.name}" is not available.` });
      if (product.stock < item.quantity) return res.status(400).json({ success: false, message: `Insufficient stock for "${product.name}". Available: ${product.stock}` });
      enrichedItems.push({ productId: item.productId, name: product.name, price: product.price, quantity: item.quantity, image: product.images?.[0] || '', sellerId: product.sellerId });
      subtotal += product.price * item.quantity;
    }

    // Apply coupon
    let discount = 0;
    if (couponCode) {
      const couponSnap = await db().collection('coupons').where('code', '==', couponCode.toUpperCase()).limit(1).get();
      if (!couponSnap.empty) {
        const coupon = couponSnap.docs[0].data();
        if (coupon.active && new Date(coupon.expiresAt) > new Date() && coupon.usedCount < coupon.maxUses && subtotal >= coupon.minOrder) {
          discount = coupon.type === 'percentage' ? Math.round(subtotal * coupon.value / 100) : coupon.value;
          await db().collection('coupons').doc(couponSnap.docs[0].id).update({ usedCount: coupon.usedCount + 1 });
        }
      }
    }

    const shipping = SHIPPING_RATES[shippingType] || SHIPPING_RATES.standard;
    const total = Math.max(0, subtotal - discount + shipping);
    const commission = Math.round(subtotal * COMMISSION_RATE);
    const orderId = generateOrderId();

    // Group by seller
    const sellerIds = [...new Set(enrichedItems.map(i => i.sellerId))];

    const orderData = {
      id: orderId,
      orderId,
      buyerId,
      buyerName: req.user.name || shippingAddress.fullName,
      buyerEmail: req.user.email,
      sellerId: sellerIds[0], // primary seller (for single-seller orders)
      sellerIds,
      items: enrichedItems,
      subtotal, shipping, discount, total, commission,
      shippingAddress,
      shippingType,
      paymentMethod,
      paymentStatus: 'pending',
      orderStatus: 'pending',
      couponCode: couponCode || null,
      transactionRef: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db().collection('orders').doc(orderId).set(orderData);

    // Decrement stock
    for (const item of enrichedItems) {
      const productRef = db().collection('products').doc(item.productId);
      const pSnap = await productRef.get();
      const newStock = (pSnap.data().stock || 0) - item.quantity;
      const updates = { stock: newStock, updatedAt: new Date().toISOString() };
      if (newStock <= 0) updates.status = 'out_of_stock';
      await productRef.update(updates);
    }

    // For CoD: return order directly
    // For digital: frontend will call payment initialization
    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      data: { orderId, total, paymentMethod, paymentStatus: 'pending' },
      redirectUrl: paymentMethod !== 'cod' ? `/api/payments/${paymentMethod}/initialize` : null,
    });
  } catch (err) {
    console.error('Place order error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/orders — buyer's order history
async function getBuyerOrders(req, res) {
  try {
    const buyerId = req.user.id || req.user.uid;
    const snap = await db().collection('orders').where('buyerId', '==', buyerId).orderBy('createdAt', 'desc').get();
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/orders/:id
async function getOrder(req, res) {
  try {
    const snap = await db().collection('orders').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = snap.data();
    const buyerId = req.user.id || req.user.uid;
    // Buyers can only see their own orders (admins see all)
    if (req.user.role !== 'admin' && order.buyerId !== buyerId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    res.json({ success: true, data: { id: snap.id, ...order } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/orders/:id/cancel
async function cancelOrder(req, res) {
  try {
    const snap = await db().collection('orders').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = snap.data();
    if (!['pending', 'confirmed'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: `Cannot cancel order in "${order.orderStatus}" status.` });
    }
    await db().collection('orders').doc(req.params.id).update({
      orderStatus: 'cancelled', updatedAt: new Date().toISOString(),
    });
    // Restore stock
    for (const item of order.items) {
      await db().collection('products').doc(item.productId).update({
        stock: require('firebase-admin').firestore.FieldValue.increment(item.quantity),
      });
    }
    res.json({ success: true, message: 'Order cancelled successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { placeOrder, getBuyerOrders, getOrder, cancelOrder };
