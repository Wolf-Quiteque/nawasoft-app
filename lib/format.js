const LUANDA_TZ = 'Africa/Luanda';

export function formatKz(value) {
  const n = Number(value) || 0;
  return `${n.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} Kz`;
}

export function formatTime(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LUANDA_TZ,
  });
}

export function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'short',
    timeZone: LUANDA_TZ,
  });
}

export function formatDateTime(dateString) {
  if (!dateString) return '—';
  return `${formatDate(dateString)} · ${formatTime(dateString)}`;
}

export function formatFullDateTime(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString('pt-PT', {
    timeZone: LUANDA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Today's date as YYYY-MM-DD in Africa/Luanda, matching the DB's trip dates. */
export function todayInLuanda() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LUANDA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function initials(firstName, lastName) {
  const a = (firstName || '').trim()[0] || '';
  const b = (lastName || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}
