#!/usr/bin/env node
'use strict';

/**
 * Alexa Shopping List — one-time cookie capture
 *
 * Usage:
 *   node scripts/alexa-setup.js
 *
 * By default, stores cookies in the local Calliad dev server (http://localhost:3001).
 * To store in the deployed app instead:
 *   CALLIAD_URL=https://calliad.vercel.app node scripts/alexa-setup.js
 *
 * When the proxy starts:
 *   1. Open your browser proxy settings and set HTTP proxy to: localhost:3456
 *   2. Navigate to https://alexa.amazon.com
 *   3. Log in to Amazon if prompted
 *   4. This script will detect the login and save your session automatically
 */

const { generateAlexaCookie } = require('alexa-cookie2');

const CALLIAD_URL = process.env.CALLIAD_URL ?? 'http://localhost:3001';

console.log('\n=== Alexa Shopping List Setup ===\n');
console.log('Starting proxy on port 3456...\n');
console.log('Next steps:');
console.log('  1. Go to System Preferences → Network → Advanced → Proxies');
console.log('     Set HTTP Proxy: localhost  Port: 3456');
console.log('  2. Open https://alexa.amazon.com in your browser');
console.log('  3. Sign in to Amazon (you\'ll see a security warning — accept it)');
console.log('  4. This script will capture your session and store it automatically');
console.log('\nWaiting for login...\n');

generateAlexaCookie(undefined, undefined, { setupProxy: true, proxyOwnIp: '127.0.0.1', proxyPort: 3456, logger: () => {} }, async (err, result) => {
  if (err) {
    // The library fires the callback with an instruction message before cookies are ready.
    // Wait for the second invocation that carries the actual cookies.
    if (err.message && err.message.includes('Please open')) {
      console.log('\nProxy is ready. Make sure your browser proxy is set to 127.0.0.1:3456');
      console.log('Now open https://alexa.amazon.com — the script will continue automatically.\n');
      return;
    }
    console.error('\n✗ Failed to capture cookies:', err.message);
    process.exit(1);
  }

  const cookie = result?.localCookie ?? result?.loginCookie;
  if (!cookie) {
    console.error('\n✗ No cookies captured. Result was:', JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log('✓ Cookies captured! Saving to Calliad...');

  const csrf = result.csrf ?? cookie.match(/csrf=([^;]+)/)?.[1] ?? '';
  if (!csrf) console.warn('  ⚠ Could not extract csrf token — list writes may fail');

  const body = JSON.stringify({
    cookie,
    csrf,
    formerRegistrationData: result,   // entire result — used by refreshAlexaCookie
    macDms: result.macDms ?? null,
  });

  try {
    const response = await fetch(`${CALLIAD_URL}/api/alexa/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-alexa-setup': 'local',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`\n✗ Calliad rejected the cookies (${response.status}): ${text}\n`);
      process.exit(1);
    }

    console.log('\n✓ Done! Alexa Shopping List is connected.\n');
    console.log('Reload the Settings page to confirm.');
    console.log('\nRemember to restore your browser proxy settings to their original values.\n');
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Could not reach Calliad at ${CALLIAD_URL}: ${msg}`);
    console.error('Make sure the dev server is running (npm run dev)\n');
    process.exit(1);
  }
});
