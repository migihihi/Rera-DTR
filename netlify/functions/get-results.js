const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const jobId = event.queryStringParameters && event.queryStringParameters.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  const store = getStore('dtr-checker-jobs');
  const job = await store.get(jobId, { type: 'json' });

  if (!job) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Job not found (yet, or expired).' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  };
};
