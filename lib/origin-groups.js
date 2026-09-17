const PRIORITY = ['Luanda', 'Benguela'];
export const NO_TRIP_GROUP = 'Sem viagem programada';

function clean(value) {
  return String(value || '').trim();
}

export function originProvinceForRun(run) {
  if (!run) return NO_TRIP_GROUP;
  const direct = clean(run.origin_province);
  if (direct) return direct;

  const rows = run.legs || run.origins || run.trips || [];
  const province = rows
    .map((row) => clean(row.origin_province || row.route?.origin_province))
    .find(Boolean);
  return province || clean(rows[0]?.origin_city || rows[0]?.route?.origin_city) || 'Outra origem';
}

function provinceRank(name) {
  if (name === NO_TRIP_GROUP) return Number.MAX_SAFE_INTEGER;
  const priority = PRIORITY.findIndex((value) => value.localeCompare(name, 'pt', { sensitivity: 'base' }) === 0);
  return priority === -1 ? PRIORITY.length : priority;
}

/** Groups buses/runs for the visual province dividers on Home and Viagens. */
export function groupByOriginProvince(items, getRun = (item) => item) {
  const groups = new Map();
  for (const item of items || []) {
    const province = originProvinceForRun(getRun(item));
    if (!groups.has(province)) groups.set(province, []);
    groups.get(province).push(item);
  }
  return [...groups.entries()]
    .map(([province, entries]) => ({ province, entries }))
    .sort((a, b) => provinceRank(a.province) - provinceRank(b.province)
      || a.province.localeCompare(b.province, 'pt', { sensitivity: 'base' }));
}
