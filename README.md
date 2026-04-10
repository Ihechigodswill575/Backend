# TAVIKMART Backend API

> Node.js + Express + Firebase — RESTful API for TAVIKMART marketplace

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js v18+ |
| Framework | Express.js |
| Database | Firebase Firestore |
| Auth | Firebase Admin SDK + JWT |
| Payments | Paystack + Flutterwave |
| Hosting | Railway / Render |

---

## Folder Structure

```
src/
├── config/         # Firebase init, Paystack config
├── middleware/     # JWT auth, role checks
├── routes/         # Route definitions
├── controllers/    # Business logic
├── utils/          # Seed script, helpers
└── app.js          # Express entry point
```

---

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/tavikmart-backend.git
cd tavikmart-backend
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
PORT=5000
NODE_ENV=development

# Firebase Admin (from Firebase Console > Project Settings > Service Accounts)
FIREBASE_PROJECT_ID=my-whatsapp-2c1af
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@my-whatsapp-2c1af.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://my-whatsapp-2c1af-default-rtdb.firebaseio.com

# JWT
JWT_SECRET=your_super_secret_here
JWT_EXPIRES_IN=7d

# Paystack (https://dashboard.paystack.com)
PAYSTACK_SECRET_KEY=sk_live_xxxx

# Flutterwave (https://dashboard.flutterwave.com)
FLUTTERWAVE_SECRET_KEY=FLWSECK_xxxx

# Frontend URL (for CORS + payment redirects)
FRONTEND_URL=http://localhost:3000

# Admin seed credentials
ADMIN_EMAIL=admin@tavikmart.com
ADMIN_PASSWORD=Tavik@Admin2025!
ADMIN_NAME=TAVIKMART Admin
```

> **Getting Firebase Admin credentials:**
> 1. Go to Firebase Console → Project Settings → Service Accounts
> 2. Click "Generate new private key"
> 3. Copy `private_key`, `client_email`, `project_id` into your `.env`

### 3. Seed Database

```bash
npm run seed
```

This creates:
- Admin user (`admin@tavikmart.com`)
- 8 product categories
- Default coupons (`TAVIK10`, `FIRST500`)
- Platform config

### 4. Run Dev Server

```bash
npm run dev
```

API live at: `http://localhost:5000`

---

## API Endpoints

### Auth — `/api/auth`
| Method | Endpoint | Auth |
|---|---|---|
| POST | `/register` | None |
| POST | `/login` | None |
| POST | `/forgot-password` | None |
| GET | `/me` | JWT |
| PUT | `/profile` | JWT |

### Products — `/api/products`
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/` | None |
| GET | `/featured` | None |
| GET | `/categories` | None |
| GET | `/:slug` | None |
| GET | `/:id/reviews` | None |
| POST | `/:id/reviews` | Buyer JWT |

### Cart — `/api/cart`
All require Buyer JWT.

### Orders — `/api/orders`
All require Buyer JWT.

### Seller — `/api/seller`
All require Seller JWT.

### Admin — `/api/admin`
All require Admin JWT.

### Payments — `/api/payments`
| Method | Endpoint | Auth |
|---|---|---|
| POST | `/paystack/webhook` | HMAC |
| POST | `/flutterwave/webhook` | HMAC |
| POST | `/paystack/initialize` | JWT |
| POST | `/paystack/verify/:ref` | JWT |
| GET | `/banks` | JWT |
| POST | `/verify-account` | JWT |

---

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your `tavikmart-backend` repo
4. Add all `.env` variables in Railway dashboard
5. Railway auto-detects Node.js and starts `node src/app.js`

Or use the included `railway.toml`:

```toml
[build]
  builder = "NIXPACKS"

[deploy]
  startCommand = "node src/app.js"
  restartPolicyType = "ON_FAILURE"
```

---

## Firestore Security Rules

Paste these in Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users: only owner or admin can read/write
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId
        || request.auth.token.role == 'admin';
    }
    // Products: public read, seller/admin write
    match /products/{productId} {
      allow read: if true;
      allow create, update: if request.auth.token.role in ['seller', 'admin'];
      allow delete: if request.auth.token.role == 'admin';
    }
    // Orders: buyer sees own, seller sees theirs, admin sees all
    match /orders/{orderId} {
      allow read: if request.auth.uid == resource.data.buyerId
        || resource.data.sellerIds.hasAny([request.auth.uid])
        || request.auth.token.role == 'admin';
      allow create: if request.auth != null;
      allow update: if request.auth.token.role in ['seller', 'admin'];
    }
    // Carts: only owner
    match /carts/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
    // Categories: public read, admin write
    match /categories/{catId} {
      allow read: if true;
      allow write: if request.auth.token.role == 'admin';
    }
    // Reviews: public read, authenticated write
    match /reviews/{reviewId} {
      allow read: if true;
      allow create: if request.auth != null;
    }
    // Coupons: auth read, admin write
    match /coupons/{couponId} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.role == 'admin';
    }
    // Config: public read, admin write
    match /config/{docId} {
      allow read: if true;
      allow write: if request.auth.token.role == 'admin';
    }
    // Stores: public read, seller/admin write
    match /stores/{storeId} {
      allow read: if true;
      allow write: if request.auth.uid == storeId
        || request.auth.token.role == 'admin';
    }
  }
}
```
