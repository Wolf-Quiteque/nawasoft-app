/**
 * Where the passenger-facing ticket PDF lives (a different app to this one).
 *
 * One link per payment reference: the page renders every ticket bought on that
 * reference as one multi-page PDF, and refuses to render at all until the
 * payment is confirmed.
 */
export function ticketDownloadUrl(reference) {
  const base = (process.env.NEXT_PUBLIC_WEBSITE_BASE_URL || 'https://www.nawabus.ao').replace(/\/+$/, '');
  return `${base}/bilhetes/${encodeURIComponent(String(reference || '').trim())}`;
}
