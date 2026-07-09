const { getConfiguredStore } = require('./blob-config');

// Synchronous functions allow ~4.5MB of binary data per request (base64
// overhead included) — background functions only allow 256KB. Scanned DTR
// PDFs run 1-3MB each, so uploads have to go through a synchronous function
// like this one, one file at a time, before the background function ever
// gets involved.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { jobId, key, base64 } = JSON.parse(event.body);
    if (!jobId || !key || !base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing jobId, key, or base64' }) };
    }

    const store = getConfiguredStore('dtr-checker-uploads');
    await store.set(`${jobId}:${key}`, base64);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
