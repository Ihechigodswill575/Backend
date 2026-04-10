// ==================== PAYMENTS CONTROLLER ====================
const axios = require('axios');
const crypto = require('crypto');
const { db } = require('../config/firebase');

const PAYSTACK_BASE = 'https://api.paystack.co';
const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

// ---- PAYSTACK ----

// POST /api/payments/paystack/initialize
async function paystackInitialize(req, res) {
  try {
    const { orderId, amount, email, callbackUrl } = req.body;
    if (!orderId || !amount || !email) {
      return res.status(400).json({ success: false, message: 'orderId, amount, and email required.' });
    }

    // Verify order exists
    const orderSnap = await db().collection('orders').doc(orderId).get();
    if (!orderSnap.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = orderSnap.data();

    const response = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
      email,
      amount: Math.round(amount * 100), // Paystack uses kobo
      reference: `TVM-${orderId}-${Date.now()}`,
      callback_url: callbackUrl || `${process.env.FRONTEND_URL}/order/${orderId}/confirm`,
      metadata: {
        orderId,
        buyerId: req.user.id || req.user.uid,
        cancel_action: `${process.env.FRONTEND_URL}/cart`,
      },
    }, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } });

    const { authorization_url, reference, access_code } = response.data.data;

    // Save reference to order
    await db().collection('orders').doc(orderId).update({
      transactionRef: reference, updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: { authorizationUrl: authorization_url, reference, accessCode: access_code } });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ success: false, message: `Paystack init failed: ${msg}` });
  }
}

// POST /api/payments/paystack/verify/:reference
async function paystackVerify(req, res) {
  try {
    const { reference } = req.params;
    const response = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const { status, metadata, amount } = response.data.data;
    if (status !== 'success') {
      return res.status(400).json({ success: false, message: `Payment ${status}. Please try again.` });
    }

    const { orderId } = metadata;
    // Update order payment status
    await db().collection('orders').doc(orderId).update({
      paymentStatus: 'paid',
      orderStatus: 'confirmed',
      transactionRef: reference,
      paidAmount: amount / 100,
      paidAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Payment confirmed!', data: { orderId, amount: amount / 100, reference } });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ success: false, message: `Verification failed: ${msg}` });
  }
}

// POST /api/payments/paystack/webhook
async function paystackWebhook(req, res) {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body);
    console.log('Paystack webhook event:', event.event);

    if (event.event === 'charge.success') {
      const { reference, metadata, amount } = event.data;
      const orderId = metadata?.orderId;
      if (orderId) {
        await db().collection('orders').doc(orderId).update({
          paymentStatus: 'paid',
          orderStatus: 'confirmed',
          transactionRef: reference,
          paidAmount: amount / 100,
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        console.log(`✅ Order ${orderId} paid via Paystack webhook`);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // Always 200 to prevent retries
  }
}

// ---- FLUTTERWAVE ----

// POST /api/payments/flutterwave/initialize
async function flutterwaveInitialize(req, res) {
  try {
    const { orderId, amount, email, name, phone, callbackUrl } = req.body;

    const response = await axios.post(`${FLUTTERWAVE_BASE}/payments`, {
      tx_ref: `TVM-FLW-${orderId}-${Date.now()}`,
      amount,
      currency: 'NGN',
      redirect_url: callbackUrl || `${process.env.FRONTEND_URL}/order/${orderId}/confirm`,
      customer: { email, name, phonenumber: phone },
      customizations: { title: 'TAVIKMART', logo: `${process.env.FRONTEND_URL}/assets/logo.svg` },
      meta: { orderId },
    }, { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } });

    res.json({ success: true, data: { paymentLink: response.data.data.link } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/payments/flutterwave/webhook
async function flutterwaveWebhook(req, res) {
  try {
    const secretHash = process.env.FLUTTERWAVE_SECRET_KEY;
    const signature = req.headers['verif-hash'];
    if (signature !== secretHash) return res.status(401).send('Invalid signature');

    const payload = JSON.parse(req.body);
    if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
      const orderId = payload.data.meta?.orderId;
      if (orderId) {
        await db().collection('orders').doc(orderId).update({
          paymentStatus: 'paid', orderStatus: 'confirmed',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
}

// GET /api/payments/banks
async function getBanks(req, res) {
  try {
    const response = await axios.get(`${PAYSTACK_BASE}/bank?country=nigeria&perPage=100`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const banks = response.data.data.map(b => ({ name: b.name, code: b.code }));
    res.json({ success: true, data: banks });
  } catch (err) {
    // Return common Nigerian banks as fallback
    res.json({ success: true, data: [
      { name: 'Access Bank', code: '044' },
      { name: 'First Bank of Nigeria', code: '011' },
      { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'United Bank for Africa', code: '033' },
      { name: 'Zenith Bank', code: '057' },
      { name: 'PalmPay', code: '999991' },
      { name: 'Opay', code: '999992' },
      { name: 'Kuda Bank', code: '999112' },
    ]});
  }
}

// POST /api/payments/verify-account
async function verifyAccount(req, res) {
  try {
    const { accountNumber, bankCode } = req.body;
    const response = await axios.get(`${PAYSTACK_BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const { account_name, account_number } = response.data.data;
    res.json({ success: true, data: { accountName: account_name, accountNumber: account_number } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.response?.data?.message || 'Verification failed.' });
  }
}

module.exports = { paystackInitialize, paystackVerify, paystackWebhook, flutterwaveInitialize, flutterwaveWebhook, getBanks, verifyAccount };
