/**
 * "Chrome on Windows", "Chrome on Android phone", "Safari on iPhone" — the device an action came
 * from, in the words the owner would use, for the Log Book. Read from the browser's User-Agent.
 *
 * Good enough to tell the shop computer from a phone; not a fingerprint, and never meant to be one.
 * Browsers deliberately blur these strings, so the answer is a label, not proof.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return '';

  let os = '';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/CrOS/i.test(ua)) os = 'Chromebook';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Order matters: Edge, Opera and Samsung's browser all also say "Chrome", and Chrome says "Safari".
  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}
