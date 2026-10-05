const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36';

function normalizeInputUrl(rawUrl) {
  return String(rawUrl || '')
    .trim()
    .replace(/^https:\/(?!\/)/, 'https://')
    .replace(/^http:\/(?!\/)/, 'http://');
}

function isShopeeShortUrl(rawUrl) {
  try {
    const hostname = new URL(normalizeInputUrl(rawUrl)).hostname.toLowerCase();
    return ['s.shopee.vn', 'shp.ee', 'vn.shp.ee'].includes(hostname);
  } catch {
    return false;
  }
}

function extractShopeeIds(rawUrl) {
  try {
    const parsed = new URL(normalizeInputUrl(rawUrl));
    const path = decodeURIComponent(parsed.pathname);

    const match =
      path.match(/\/product\/(\d+)\/(\d+)/) ||
      path.match(/\/[^/]+\/(\d+)\/(\d+)/) ||
      path.match(/-i\.(\d+)\.(\d+)/);

    if (!match) return { shopId: '', itemId: '' };

    return {
      shopId: String(match[1]),
      itemId: String(match[2]),
    };
  } catch {
    return { shopId: '', itemId: '' };
  }
}

function normalizeShopeeProductUrl(rawUrl) {
  const { shopId, itemId } = extractShopeeIds(rawUrl);
  if (!shopId || !itemId) return rawUrl;

  return `https://shopee.vn/product/${shopId}/${itemId}`;
}

async function expandShortUrl(url) {
  let currentUrl = normalizeInputUrl(url);

  try {
    for (let i = 0; i < 10; i++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const location = res.headers.get('location');
      if (!location) break;

      currentUrl = new URL(location, currentUrl).href;
    }

    return normalizeShopeeProductUrl(currentUrl);
  } catch {
    return normalizeShopeeProductUrl(currentUrl);
  }
}

async function getProductData(shopeeUrl, itemId) {
  const apiUrl = new URL(
    'https://data.addlivetag.com/product-data/product-data.php'
  );

  if (shopeeUrl) {
    apiUrl.searchParams.set('url', shopeeUrl);
  } else {
    apiUrl.searchParams.set('item_id', itemId);
  }

  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      'accept': 'application/json',
      'X-API-Key': process.env.ADDLIVETAG_API_KEY,
    },
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });

  if (!res.ok) {
    throw new Error('Khong lay duoc thong tin san pham');
  }

  const data = await res.json();

  if (data?.status !== 'success' || !data.productInfo) {
    throw new Error('Khong lay duoc thong tin san pham');
  }

  return data;
}

function pickProductInfo(data, resolvedUrl) {
  const source = data?.productInfo || {};
  const ids = extractShopeeIds(source.productLink || resolvedUrl);

  return {
    itemId: source.itemId || ids.itemId,
    shopId: source.shopId || ids.shopId,
    productName: source.productName || '',
    shopName: source.shopName || '',
    price: Number(source.price || 0),
    sales: Number(source.sales || 0),
    imageUrl: source.imageUrl || '',
    rating: source.rating || '0',
    commission: Number(source.commission || 0),
    isXtra: Boolean(source.isXtra),
    hasSellerCommission: Boolean(source.hasSellerCommission),
    hasShopeeCommission: Boolean(source.hasShopeeCommission),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({
      status: 'error',
      error: 'Chi ho tro GET',
    });
  }

  const rawUrl = Array.isArray(req.query?.url)
    ? req.query.url[0]
    : req.query?.url;

  const itemId = req.query?.item_id;

  if (!rawUrl && !(typeof itemId === 'string' && /^\d+$/.test(itemId))) {
    return res.status(400).json({
      status: 'error',
      error: 'Thieu tham so url hoac item_id hop le',
    });
  }

  if (!process.env.ADDLIVETAG_API_KEY?.trim()) {
    return res.status(503).json({
      status: 'error',
      error: 'May chu chua cau hinh API lay thong tin san pham',
    });
  }

  try {
    let resolvedUrl = normalizeInputUrl(rawUrl);

    if (isShopeeShortUrl(resolvedUrl)) {
      resolvedUrl = await expandShortUrl(resolvedUrl);
    } else {
      resolvedUrl = normalizeShopeeProductUrl(resolvedUrl);
    }

    const data = await getProductData(resolvedUrl, itemId);

    return res.status(200).json({
      status: 'success',
      productInfo: pickProductInfo(data, resolvedUrl),
    });
  } catch {
    return res.status(500).json({
      status: 'error',
      error: 'Khong lay duoc thong tin san pham',
    });
  }
}
