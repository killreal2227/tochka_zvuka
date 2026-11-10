// Fixed destinations only. No message/token logging or background acknowledgements.
const METHODS = new Set(['getMe', 'sendMessage', 'answerCallbackQuery', 'sendDocument']);
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function sameSecret(actual, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || !actual || actual.length > 512) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map(s => crypto.subtle.digest('SHA-256', encode.encode(s))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function limitedBody(request, maximum) {
  if (Number(request.headers.get('content-length')) > maximum) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function origin(env) {
  const url = new URL(env.YANDEX_FUNCTION_URL);
  const allowed = (url.hostname === 'functions.yandexcloud.net' && /^\/[a-zA-Z0-9_-]+$/.test(url.pathname)) ||
    (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.apigw\.yandexcloud\.net$/.test(url.hostname) && ['', '/'].includes(url.pathname));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !allowed) throw new Error('configuration');
  return url.href;
}

async function telegram(method, body, contentType, env, upstream) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(env.BOT_TOKEN || '')) throw new Error('configuration');
  return upstream(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': contentType }, body,
    redirect: 'manual', signal: AbortSignal.timeout(8000),
  });
}

export async function handleRequest(request, env, upstream = (...args) => globalThis.fetch(...args)) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    let originValid = false;
    try { origin(env); originValid = true; } catch {}
    return reply({ relay: 'OK', version: 3, configuration: {
      BOT_TOKEN: /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(env.BOT_TOKEN || '') ? 'set' : 'missing_or_invalid',
      WEBHOOK_SECRET: /^[A-Za-z0-9_-]{32,256}$/.test(env.WEBHOOK_SECRET || '') ? 'set' : 'missing_or_invalid',
      RELAY_SECRET: /^[A-Za-z0-9_-]{32,256}$/.test(env.RELAY_SECRET || '') ? 'set' : 'missing_or_invalid',
      YANDEX_FUNCTION_URL: originValid ? 'set' : 'missing_or_invalid',
    } });
  }
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    if (url.pathname === '/telegram') {
      if (!await sameSecret(request.headers.get('x-telegram-bot-api-secret-token'), env.WEBHOOK_SECRET)) return reply({ error: 'Forbidden' }, 403);
      if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return reply({ error: 'JSON required' }, 415);
      const body = await limitedBody(request, 100000);
      let update;
      try { update = JSON.parse(new TextDecoder().decode(body)); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) return reply({ error: 'Invalid update' }, 400);
      const response = await upstream(origin(env), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': env.WEBHOOK_SECRET },
        body, redirect: 'manual', signal: AbortSignal.timeout(18000),
      });
      // Acknowledge only after origin completed. Telegram retries on non-2xx.
      await response.body?.cancel();
      return response.status === 200 ? reply({ ok: true }) : reply({ error: 'Origin rejected update' }, 503);
    }

    if (!await sameSecret(request.headers.get('authorization'), `Bearer ${env.RELAY_SECRET || ''}`) ||
        typeof env.RELAY_SECRET !== 'string' || env.RELAY_SECRET.length < 32) return reply({ error: 'Forbidden' }, 403);

    if (url.pathname === '/diagnostics') {
      const checks = {};
      for (const target of ['telegram', 'yandex']) {
        const started = Date.now();
        try {
          const response = target === 'telegram'
            ? await telegram('getMe', '{}', 'application/json', env, upstream)
            : await upstream(origin(env), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
          if (target === 'telegram') {
            const data = await response.json();
            checks[target] = { ok: response.status === 200 && data.ok === true && data.result?.username === 'tochkazvuka_bot', status: response.status };
          } else {
            await response.body?.cancel();
            checks[target] = { ok: response.status === 403, status: response.status };
          }
        } catch (error) {
          const kind = ['TypeError', 'TimeoutError', 'AbortError', 'SyntaxError'].includes(error?.name) ? error.name : 'Connection failed';
          checks[target] = { ok: false, error: kind };
        }
        checks[target].milliseconds = Date.now() - started;
      }
      return reply(checks);
    }

    const method = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : '';
    if (!METHODS.has(method)) return reply({ error: 'Method not allowed' }, 404);
    const contentType = request.headers.get('content-type') || '';
    const json = contentType.toLowerCase().startsWith('application/json');
    const multipart = contentType.toLowerCase().startsWith('multipart/form-data;');
    if (!json && !(method === 'sendDocument' && multipart)) return reply({ error: 'Unsupported content type' }, 415);
    const body = await limitedBody(request, method === 'sendDocument' ? 2000000 : 100000);
    const response = await telegram(method, body, contentType, env, upstream);
    // Do not forward arbitrary upstream headers or redirects.
    return new Response(response.body, { status: response.status, headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    } });
  } catch (error) {
    return error instanceof RangeError ? reply({ error: 'Too large' }, 413) : reply({ error: 'Relay request failed' }, 502);
  }
}

export default { fetch(request, env) { return handleRequest(request, env); } };
