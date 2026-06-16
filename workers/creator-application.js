const REQUIRED_FIELDS = ['name', 'email', 'social', 'location', 'iphone', 'used', 'capacity'];
const MAX_FIELD_LENGTH = 900;

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin)
    }
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'https://tasnif.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://tasnif.app,https://www.tasnif.app')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || 'https://tasnif.app';
  return allowedOrigins(env).includes(origin) ? origin : '';
}

function clean(value) {
  return String(value || '').trim().slice(0, MAX_FIELD_LENGTH);
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePayload(input) {
  const payload = {};
  for (const [key, value] of Object.entries(input || {})) {
    payload[key] = clean(value);
  }
  return payload;
}

function validatePayload(payload) {
  if (payload.website) {
    return { ok: true, spam: true };
  }

  const missing = REQUIRED_FIELDS.filter((field) => !payload[field]);
  if (missing.length) {
    return { ok: false, reason: 'missing_fields' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return { ok: false, reason: 'invalid_email' };
  }

  return { ok: true, spam: false };
}

function telegramMessage(payload, request) {
  return [
    '<b>Nouvelle candidature createur Tasnif</b>',
    '',
    `<b>Nom</b>: ${escapeHtml(payload.name)}`,
    `<b>Email</b>: ${escapeHtml(payload.email)}`,
    `<b>Compte</b>: ${escapeHtml(payload.social)}`,
    `<b>Ville</b>: ${escapeHtml(payload.location)}`,
    `<b>iPhone</b>: ${escapeHtml(payload.iphone)}`,
    `<b>Abonnes</b>: ${escapeHtml(payload.followers || '0')}`,
    `<b>Deja utilise Tasnif</b>: ${escapeHtml(payload.used)}`,
    `<b>Videos cette semaine</b>: ${escapeHtml(payload.capacity)}`,
    '',
    '<b>Idee</b>:',
    escapeHtml(payload.idea || 'Non precisee'),
    '',
    `<b>Source</b>: ${escapeHtml(payload.source || 'postuler.html')}`
  ].join('\n');
}

async function sendTelegram(payload, request, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('Missing Telegram secrets');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramMessage(payload, request),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    throw new Error('Telegram send failed');
  }
}

export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
    }

    if (!origin) {
      return json({ ok: false, error: 'forbidden_origin' }, 403);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 20000) {
      return json({ ok: false, error: 'payload_too_large' }, 413, origin);
    }

    let payload;
    try {
      payload = normalizePayload(await request.json());
    } catch (error) {
      return json({ ok: false, error: 'invalid_json' }, 400, origin);
    }

    const validation = validatePayload(payload);
    if (!validation.ok) {
      return json({ ok: false, error: validation.reason }, 400, origin);
    }

    if (validation.spam) {
      return json({ ok: true }, 200, origin);
    }

    try {
      await sendTelegram(payload, request, env);
      return json({ ok: true }, 200, origin);
    } catch (error) {
      return json({ ok: false, error: 'delivery_failed' }, 502, origin);
    }
  }
};
