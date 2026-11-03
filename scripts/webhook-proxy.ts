import 'dotenv/config';
import { createServer } from 'node:http';
if (process.env.NODE_ENV === 'production') throw new Error('DEVELOPMENT_ONLY');
const base = new URL(
  process.env.API_BASE_URL ?? 'http://localhost:4100/api/v1',
);
if (
  base.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(base.hostname)
)
  throw new Error('LOCAL_API_REQUIRED');
const target = base.toString().replace(/\/$/, '') + '/billing/razorpay/webhook';
createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST' || req.url !== '/razorpay') {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const signature = req.headers['x-razorpay-signature'],
      eventId = req.headers['x-razorpay-event-id'];
    if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature,
        ...(typeof eventId === 'string'
          ? { 'x-razorpay-event-id': eventId }
          : {}),
      },
      body: Buffer.concat(chunks),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(await upstream.text());
  } catch {
    res.writeHead(503);
    res.end();
  }
}).listen(4600, '127.0.0.1', () =>
  console.log(
    'Local Razorpay webhook-only proxy ready at http://127.0.0.1:4600/razorpay. No payment data is logged.',
  ),
);
