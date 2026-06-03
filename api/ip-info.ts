import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract client IP from Vercel/proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim())
    || req.socket?.remoteAddress
    || 'unknown';

  // Skip geolocation for private/loopback addresses
  const isPrivate = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fd)/.test(ip);
  if (isPrivate || ip === 'unknown') {
    return res.status(200).json({ ip });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'User-Agent': 'elnode-erp/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!geoRes.ok) {
      return res.status(200).json({ ip });
    }

    const d = await geoRes.json();
    return res.status(200).json({
      ip: d.ip || ip,
      city: d.city || undefined,
      region: d.region || undefined,
      country: d.country_name || undefined,
      isp: d.org || undefined,
    });
  } catch {
    return res.status(200).json({ ip });
  }
}
