// ==================== TAVIKMART SEED SCRIPT ====================
// Run: node src/utils/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initFirebase, db, auth } = require('../config/firebase');

initFirebase();

const CATEGORIES = [
  { id: 'electronics', name: 'Electronics', icon: '📱', slug: 'electronics', sortOrder: 1 },
  { id: 'fashion', name: 'Fashion', icon: '👗', slug: 'fashion', sortOrder: 2 },
  { id: 'home', name: 'Home & Living', icon: '🏠', slug: 'home', sortOrder: 3 },
  { id: 'beauty', name: 'Beauty', icon: '💄', slug: 'beauty', sortOrder: 4 },
  { id: 'sports', name: 'Sports', icon: '⚽', slug: 'sports', sortOrder: 5 },
  { id: 'food', name: 'Grocery', icon: '🛒', slug: 'food', sortOrder: 6 },
  { id: 'automotive', name: 'Automotive', icon: '🚗', slug: 'automotive', sortOrder: 7 },
  { id: 'books', name: 'Books', icon: '📚', slug: 'books', sortOrder: 8 },
];

async function seed() {
  console.log('🌱 Seeding TAVIKMART database...\n');

  // 1. Seed categories
  console.log('📦 Seeding categories...');
  for (const cat of CATEGORIES) {
    await db().collection('categories').doc(cat.id).set({
      ...cat, active: true, productCount: 0, createdAt: new Date().toISOString(),
    });
    console.log(`  ✅ ${cat.name}`);
  }

  // 2. Seed admin user
  console.log('\n👤 Seeding admin user...');
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@tavikmart.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Tavik@Admin2025!';
  const adminName = process.env.ADMIN_NAME || 'TAVIKMART Admin';

  let adminUid;
  try {
    const existing = await auth().getUserByEmail(adminEmail);
    adminUid = existing.uid;
    console.log(`  ℹ️  Admin already exists (${adminEmail}), updating...`);
    await auth().updateUser(adminUid, { displayName: adminName });
  } catch {
    const newAdmin = await auth().createUser({ email: adminEmail, password: adminPassword, displayName: adminName });
    adminUid = newAdmin.uid;
    console.log(`  ✅ Admin Firebase user created`);
  }

  await auth().setCustomUserClaims(adminUid, { role: 'admin' });
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await db().collection('users').doc(adminUid).set({
    id: adminUid, name: adminName, email: adminEmail,
    role: 'admin', status: 'active', passwordHash,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  console.log(`  ✅ Admin Firestore record saved`);
  console.log(`  📧 Email: ${adminEmail}`);
  console.log(`  🔑 Password: ${adminPassword}`);

  // 3. Seed default coupon
  console.log('\n🎟️  Seeding default coupons...');
  const coupons = [
    { code: 'TAVIK10', type: 'percentage', value: 10, minOrder: 5000, maxUses: 1000, description: '10% off any order over ₦5,000' },
    { code: 'FIRST500', type: 'fixed', value: 500, minOrder: 2000, maxUses: 500, description: '₦500 off first order' },
  ];
  for (const coupon of coupons) {
    const id = coupon.code.toLowerCase();
    await db().collection('coupons').doc(id).set({
      ...coupon, id, usedCount: 0, active: true,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    console.log(`  ✅ ${coupon.code} — ${coupon.description}`);
  }

  // 4. Platform config
  console.log('\n⚙️  Setting platform config...');
  await db().collection('config').doc('platform').set({
    commissionRate: 5,
    currency: 'NGN',
    currencySymbol: '₦',
    freeShippingThreshold: 20000,
    standardShipping: 1500,
    expressShipping: 3500,
    supportEmail: 'support@ihechigodswill575@gmail.com',
    supportWhatsApp: '+2348145688688',
    updatedAt: new Date().toISOString(),
  });
  console.log('  ✅ Platform config saved');

  console.log('\n✨ Seeding complete!\n');
  console.log('='.repeat(50));
  console.log('Admin Login:');
  console.log(`  URL:      /admin/dashboard`);
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Password: ${adminPassword}`);
  console.log('='.repeat(50));
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
