// Notification channels: console (always), ntfy.sh push, Telegram bot.
// Each channel failure is logged but never crashes the run.

const EVENT_META = {
  new: { emoji: '🆕', label: 'NEW', ntfyTags: 'new', priority: 'default' },
  restock: { emoji: '🔁', label: 'RESTOCK', ntfyTags: 'rotating_light', priority: 'high' },
  price_drop: { emoji: '💸', label: 'PRICE DROP', ntfyTags: 'moneybag', priority: 'default' },
};

const MAX_DETAILED = 10;

function fmtPrice(p) {
  return typeof p === 'number' ? `£${p.toFixed(2)}` : '£?';
}

function eventLine(ev) {
  const m = EVENT_META[ev.type];
  let line = `${m.emoji} ${m.label}: ${ev.item.name} — ${fmtPrice(ev.item.price)}`;
  if (ev.type === 'price_drop') line += ` (was ${fmtPrice(ev.oldPrice)})`;
  if (ev.type === 'new' && !ev.item.inStock) line += ' [not in stock yet]';
  return line;
}

async function sendNtfy(events, targetLabel, ntfyCfg) {
  const server = (ntfyCfg.server || 'https://ntfy.sh').replace(/\/$/, '');
  const detailed = events.slice(0, MAX_DETAILED);
  for (const ev of detailed) {
    const m = EVENT_META[ev.type];
    const headers = {
      Title: `${m.label} · ${targetLabel}`,
      Click: ev.item.url,
      Tags: m.ntfyTags,
      Priority: m.priority,
    };
    if (ev.item.image) headers.Attach = ev.item.image;
    await fetch(`${server}/${ntfyCfg.topic}`, {
      method: 'POST',
      headers,
      body: eventLine(ev),
    });
  }
  if (events.length > detailed.length) {
    await fetch(`${server}/${ntfyCfg.topic}`, {
      method: 'POST',
      headers: { Title: targetLabel, Tags: 'information_source' },
      body: `…and ${events.length - detailed.length} more changes (see watcher log)`,
    });
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(events, targetLabel, tgCfg) {
  const lines = events.slice(0, MAX_DETAILED).map((ev) => {
    const m = EVENT_META[ev.type];
    let l = `${m.emoji} <b>${m.label}</b>: <a href="${ev.item.url}">${escapeHtml(ev.item.name)}</a> — ${fmtPrice(ev.item.price)}`;
    if (ev.type === 'price_drop') l += ` (was ${fmtPrice(ev.oldPrice)})`;
    return l;
  });
  if (events.length > MAX_DETAILED) lines.push(`…and ${events.length - MAX_DETAILED} more`);
  const resp = await fetch(`https://api.telegram.org/bot${tgCfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: tgCfg.chatId,
      text: `<b>${escapeHtml(targetLabel)}</b>\n` + lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: events.length > 1,
    }),
  });
  if (!resp.ok) throw new Error(`telegram ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

async function notify(events, targetLabel, notifyCfg) {
  if (!events.length) return;
  for (const ev of events) {
    console.log(`  ${eventLine(ev)}\n     ${ev.item.url}`);
  }
  if (notifyCfg.ntfy && notifyCfg.ntfy.enabled) {
    try {
      await sendNtfy(events, targetLabel, notifyCfg.ntfy);
    } catch (e) {
      console.error(`  [notify] ntfy failed: ${e.message}`);
    }
  }
  if (notifyCfg.telegram && notifyCfg.telegram.enabled) {
    try {
      await sendTelegram(events, targetLabel, notifyCfg.telegram);
    } catch (e) {
      console.error(`  [notify] telegram failed: ${e.message}`);
    }
  }
}

module.exports = { notify, eventLine };
