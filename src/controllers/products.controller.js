// ==================== PRODUCTS CONTROLLER ====================
const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/products — public, with filters
async function getProducts(req, res) {
  try {
    const { q, category, minPrice, maxPrice, sort, page = 1, limit = 20, featured, sale } = req.query;
    let ref = db().collection('products').where('status', '==', 'approved');

    if (category) ref = ref.where('category', '==', category);
    if (featured === 'true') ref = ref.where('featured', '==', true);

    // Sorting (only one orderBy at a time without composite index)
    if (sort === 'price_asc') ref = ref.orderBy('price', 'asc');
    else if (sort === 'price_desc') ref = ref.orderBy('price', 'desc');
    else if (sort === 'rating') ref = ref.orderBy('rating', 'desc');
    else ref = ref.orderBy('createdAt', 'desc');

    const snap = await ref.get();
    let products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Client-side filters
    if (q) {
      const search = q.toLowerCase();
      products = products.filter(p =>
        p.name?.toLowerCase().includes(search) ||
        p.description?.toLowerCase().includes(search) ||
        p.sellerName?.toLowerCase().includes(search) ||
        p.tags?.some(t => t.toLowerCase().includes(search))
      );
    }
    if (minPrice) products = products.filter(p => p.price >= parseFloat(minPrice));
    if (maxPrice) products = products.filter(p => p.price <= parseFloat(maxPrice));
    if (sale === 'true') products = products.filter(p => p.oldPrice && p.oldPrice > p.price);

    // Pagination
    const total = products.length;
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const start = (pageNum - 1) * limitNum;
    const paginated = products.slice(start, start + limitNum);

    res.json({
      success: true,
      data: paginated,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/products/featured
async function getFeatured(req, res) {
  try {
    const snap = await db().collection('products')
      .where('status', '==', 'approved')
      .where('featured', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(12)
      .get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/products/categories
async function getCategories(req, res) {
  try {
    const snap = await db()
      .collection('categories')
      .where('active', '==', true)
      .orderBy('sortOrder', 'asc')
      .get();

    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (cats.length === 0) {
      return res.json({
        success: true, data: [
          { id: 'electronics', name: 'Electronics', icon: '📱', slug: 'electronics' },
          { id: 'fashion', name: 'Fashion', icon: '👗', slug: 'fashion' },
          { id: 'home', name: 'Home & Living', icon: '🏠', slug: 'home' },
          { id: 'beauty', name: 'Beauty', icon: '💄', slug: 'beauty' },
          { id: 'sports', name: 'Sports', icon: '⚽', slug: 'sports' },
          { id: 'food', name: 'Grocery', icon: '🛒', slug: 'food' },
          { id: 'automotive', name: 'Automotive', icon: '🚗', slug: 'automotive' },
          { id: 'books', name: 'Books', icon: '📚', slug: 'books' },
        ],
      });
    }
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/products/:slug
async function getProduct(req, res) {
  try {
    const { slug } = req.params;

    // Try by slug first
    let snap = await db().collection('products').where('slug', '==', slug).limit(1).get();

    if (snap.empty) {
      // Try by document ID
      const byId = await db().collection('products').doc(slug).get();
      if (!byId.exists) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }
      return res.json({ success: true, data: { id: byId.id, ...byId.data() } });
    }

    const product = { id: snap.docs[0].id, ...snap.docs[0].data() };

    // Get related products
    const relatedSnap = await db().collection('products')
      .where('category', '==', product.category)
      .where('status', '==', 'approved')
      .limit(6)
      .get();

    const related = relatedSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.id !== product.id)
      .slice(0, 4);

    res.json({ success: true, data: product, related });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/products/:id/reviews — buyer only
async function addReview(req, res) {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const buyerId = req.user.id || req.user.uid;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    // Check product exists
    const productSnap = await db().collection('products').doc(id).get();
    if (!productSnap.exists) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const reviewId = uuidv4();
    const review = {
      id: reviewId,
      productId: id,
      buyerId,
      buyerName: req.user.name || 'Anonymous',
      rating: parseInt(rating),
      comment: comment || '',
      createdAt: new Date().toISOString(),
    };

    await db().collection('reviews').doc(reviewId).set(review);

    // Recalculate product average rating
    const allReviews = await db().collection('reviews').where('productId', '==', id).get();
    const ratings = allReviews.docs.map(d => d.data().rating);
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;

    await db().collection('products').doc(id).update({
      rating: Math.round(avgRating * 10) / 10,
      reviewCount: ratings.length,
      updatedAt: new Date().toISOString(),
    });

    res.status(201).json({ success: true, message: 'Review submitted!', data: review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/products/:id/reviews
async function getReviews(req, res) {
  try {
    const snap = await db().collection('reviews')
      .where('productId', '==', req.params.id)
      .orderBy('createdAt', 'desc')
      .get();
    const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getProducts, getFeatured, getProduct, getCategories, addReview, getReviews };
