const { getStore } = require('@netlify/blobs');

// Netlify is supposed to auto-configure Blobs for functions with no setup
// needed — getStore('name') alone should just work. In practice this fails
// intermittently on some sites for reasons that aren't well documented, and
// when it fails, the error itself tells you the fix: pass siteID and token
// explicitly. This helper does that everywhere Blobs is used, using two
// env vars you set once in Netlify (see README).
function getConfiguredStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      'Missing BLOBS_SITE_ID or BLOBS_TOKEN environment variable. See README.md "Manual Blobs configuration" for how to get these from Netlify.'
    );
  }

  return getStore({ name, siteID, token });
}

module.exports = { getConfiguredStore };
