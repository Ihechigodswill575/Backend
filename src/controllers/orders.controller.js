// ==================== ORDERS CONTROLLER ====================
const { db, admin } = require('../config/firebase');

const COMMISSION_RATE = parseFloat(process.env.TAVIKMART_COMMISSION_RATE || '5') / 100;
const SHIPPING_RATES = { standard: 1500, express: 3500 };

function generateOrderId() {
  return 'TVM-' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// POST /api/orders — place new order
async function placeOrder(req, res) {
  try {
    const buyerId = req.user.id || req.user.uid;
    const {
      items, shippingAddress, paymentMethod = 'cod',
      shippingType = 'standard', couponCode,
    } = req.body;

    if (!items?.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }
    if (!shippingAddress?.address && !shippingAddress?.street) {
      return res.status(400).json({ success: false, message: 'Shipping address required.' });
    }
    if (!['cod', 'paystack', 'flutterwave'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Invalid payment method.' });
    }

    // Validate products & stock in a batch
    const productRefs = items.map(item => db().collection('products').doc(item.productId));
    const productSnaps = await Promise.all(productRefs.map(ref => ref.get()));

    const enrichedItems = [];
    let subtotal = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const productSnap = productSnaps[i];

      if (!productSnap.exists) {
        return res.status(404).json({ success: false, message: `Product ${item.productId} not found.` });
      }

      const product = productSnap.data();

      if (product.status !== 'approved') {
        return res.status(400).json({ success: false, message: `Product "${product.name}" is not available.` });
      }
      if ((product.stock || 0) < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${product.stock}`,
        });
      }

      enrichedItems.push({
        productId: item.productId,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image: product.images?.[0] || product.imageUrl || '',
        sellerId: product.sellerId,
      });
      subtotal += product.price * item.quantity;
    }

    // Apply coupon
    let discount = 0;
    if (couponCode) {
      const couponSnap = await db()
        .collection('coupons')
        .where('code', '==', couponCode.toUpperCase())
        .limit(1)
        .get();

      if (!couponSnap.empty) {
        const couponDoc = couponSnap.docs[0];
        const coupon = couponDoc.data();

        const isValid =
          coupon.active &&
          new Date(coupon.expiresAt) > new Date() &&
          coupon.usedCount < coupon.maxUses &&
          subtotal >= coupon.minOrder;

        if (isValid) {
          discount = coupon.type === 'percentage'
            ? Math.round(subtotal * coupon.value / 100)
            : coupon.value;

          await couponDoc.ref.update({ usedCount: admin.firestore.FieldValue.increment(1) });
        }
      }
    }

    const shipping = SHIPPING_RATES[shippingType] || SHIPPING_RATES.standard;
    const total = Math.max(0, subtotal - discount + shipping);
    const commission = Math.round(subtotal * COMMISSION_RATE);
    const orderId = generateOrderId();
    const sellerIds = [...new Set(enrichedItems.map(i => i.sellerId))];

    const orderData = {
      id: orderId,
      orderId,
      buyerId,
      buyerName: req.user.name || shippingAddress.fullName || '',
      buyerEmail: req.user.email || '',
      sellerId: sellerIds[0] || null,
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

    // Decrement stock concurrently
    await Promise.all(
      enrichedItems.map(async (item) => {
        const productRef = db().collection('products').doc(item.productId);
        const updates = {
          stock: admin.firestore.FieldValue.increment(-item.quantity),
          updatedAt: new Date().toISOString(),
        };
        // Also mark out of stock if needed (we do this via a separate read only if strictly necessary)
        await productRef.update(updates);
      })
    );

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      data: { orderId, total, paymentMethod, paymentStatus: 'pending' },
      redirectUrl: paymentMethod !== 'cod'
        ? `/api/payments/${paymentMethod}/initialize`
        : null,
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
    const snap = await db()
      .collection('orders')
      .where('buyerId', '==', buyerId)
      .orderBy('createdAt', 'desc')
      .get();
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
    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const order = snap.data();
    const buyerId = req.user.id || req.user.uid;

    if (req.user.role !== 'admin' && order.buyerId !== buyerId && !order.sellerIds?.includes(buyerId)) {
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
    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const order = snap.data();
    const buyerId = req.user.id || req.user.uid;

    // Only buyer or admin can cancel
    if (req.user.role !== 'admin' && order.buyerId !== buyerId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!['pending', 'confirmed'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in "${order.orderStatus}" status.`,
      });
    }

    await db().collection('orders').doc(req.params.id).update({
      orderStatus: 'cancelled',
      updatedAt: new Date().toISOString(),
    });

    // Restore stock
    await Promise.all(
      order.items.map(item =>
        db().collection('products').doc(item.productId).update({
          stock: admin.firestore.FieldValue.increment(item.quantity),
          updatedAt: new Date().toISOString(),
        })
      )
    );

    res.json({ success: true, message: 'Order cancelled successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { placeOrder, getBuyerOrders, getOrder, cancelOrder };
