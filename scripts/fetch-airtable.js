// scripts/fetch-airtable.js
// Fetches all 9 Airtable tables and updates index.html
// Run automatically by GitHub Actions — do not run manually with your token exposed.

const fs   = require('fs');
const path = require('path');

const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const AT_BASE  = process.env.AIRTABLE_BASE;

if (!AT_TOKEN || !AT_BASE) {
  console.error('ERROR: AIRTABLE_TOKEN and AIRTABLE_BASE must be set as environment variables.');
  process.exit(1);
}

// ── FETCH HELPER ──

async function fetchTable(table, sortField) {
  let url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`
    + `?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100`;
  let records = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AT_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable error on table "${table}": ${res.status} ${res.statusText}`);
    const data = await res.json();
    records = records.concat(data.records.map(r => r.fields));
    url = data.offset
      ? `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`
        + `?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100&offset=${data.offset}`
      : null;
  }
  return records;
}

// ── DATE FORMATTER ──

function fmtDate(val) {
  if (!val) return '—';
  const parts = val.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
  return val;
}

// ── DATA MAPPERS (for JS data arrays) ──

function mapPop(r)    { return { y:r['Year'], lo:r['Lower Bound'], med:r['Median'], hi:r['Upper Bound'] }; }
function mapMon(r)    { return { y:r['Year'], s:r['Sightings'], u:r['Unique IDs'], p:r['Population Estimate'], e:r['Effort (1k km)'], pct:r['Percent Population Seen'] }; }
function mapRepro(r)  { return { y:r['Year'], calves:r['Calf Count'], cows:r['Available Cows'], pctCalved:r['Percent Calved'], avgI:r['Avg Inter-Birth Interval']??null, medI:r['Median Inter-Birth Interval']??null, minI:r['Min Interval']??null, maxI:r['Max Interval']??null, firstMoms:r['First-time Moms'] }; }
function mapRegion(r) { return { name:r['Region Name'], sightings:r['Sightings'], months:r['Active Months'] }; }
function mapMort(r)   { return { y:r['Year'], ca:r['Canada']||0, us:r['US']||0 }; }
function mapCause(r)  { return { y:r['Year'], vs:r['Vessel Strike']||0, ent:r['Entanglement']||0, neo:r['Neonate']||0, unk:r['Unknown']||0, oth:r['Other']||0 }; }

// ── HTML ROW BUILDERS (for static threat tables) ──

function buildEntangleRows(records) {
  return records.map(r =>
    `<tr>` +
    `<td><strong style="color:var(--amber)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Entanglement Sighting'])}</td>` +
    `<td>${r['Pre-Entanglement Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['First Sighting'])}</td>` +
    `<td>${r['Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="font-size:0.78rem;color:rgba(240,236,227,0.75)">${r['Status/Details']||'—'}</span></td>` +
    `</tr>`
  ).join('\n');
}

function buildScarsRows(records) {
  return records.map(r =>
    `<tr>` +
    `<td><strong style="color:var(--amber)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Injury Date'])}</td>` +
    `<td>${r['Pre-Injury Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['Injury Detection Date'])}</td>` +
    `<td>${r['Detection Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="font-size:0.78rem;color:rgba(240,236,227,0.75)">${r['Status/Details']||'—'}</span></td>` +
    `</tr>`
  ).join('\n');
}

function buildVesselRows(records) {
  return records.map(r =>
    `<tr>` +
    `<td><strong style="color:var(--coral)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Injury Date'])}</td>` +
    `<td>${r['Pre-Injury Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['Injury Detection Date'])}</td>` +
    `<td>${r['Detection Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="font-size:0.78rem;color:rgba(240,236,227,0.75)">${r['Status/Details']||'—'}</span></td>` +
    `</tr>`
  ).join('\n');
}

// ── INJECT HELPER ──

function injectBetweenMarkers(html, startMarker, endMarker, content) {
  const startIdx = html.indexOf(startMarker);
  const endIdx   = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) throw new Error(`Markers not found: ${startMarker}`);
  return html.slice(0, startIdx + startMarker.length) + '\n' + content + '\n' + html.slice(endIdx);
}

// ── MAIN ──

async function main() {
  console.log('Fetching all 9 tables from Airtable...');

  const [popRaw, monRaw, reproRaw, regionRaw, mortRaw, causeRaw,
         entangleRaw, scarsRaw, vesselRaw] = await Promise.all([
    fetchTable('Population Estimates',        'Year'),
    fetchTable('Annual Monitoring',           'Year'),
    fetchTable('Reproduction',                'Year'),
    fetchTable('Sightings by Region',         'Region Name'),
    fetchTable('Mortalities by Country',      'Year'),
    fetchTable('Mortalities by Cause',        'Year'),
    fetchTable('Active Entanglement Cases',   'First Sighting'),
    fetchTable('Entanglement Scars Only',     'Injury Detection Date'),
    fetchTable('Vessel Strike Cases',         'Injury Detection Date'),
  ]);

  console.log(`Fetched: ${popRaw.length} pop, ${monRaw.length} mon, ${reproRaw.length} repro, `
    + `${regionRaw.length} regions, ${mortRaw.length} mort, ${causeRaw.length} cause, `
    + `${entangleRaw.length} entangle, ${scarsRaw.length} scars, ${vesselRaw.length} vessel records`);

  // ── Read HTML ──
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // ── 1. Inject JS data arrays ──
  const dataBlock = `/* AIRTABLE_DATA_START */
var popData = ${JSON.stringify(popRaw.map(mapPop))};
var monData = ${JSON.stringify(monRaw.map(mapMon))};
var reproData = ${JSON.stringify(reproRaw.map(mapRepro))};
var regionData = ${JSON.stringify(regionRaw.map(mapRegion))};
var mortData = ${JSON.stringify(mortRaw.map(mapMort))};
var causeData = ${JSON.stringify(causeRaw.map(mapCause))};
/* AIRTABLE_DATA_END */`;

  const ds = html.indexOf('/* AIRTABLE_DATA_START */');
  const de = html.indexOf('/* AIRTABLE_DATA_END */') + '/* AIRTABLE_DATA_END */'.length;
  if (ds === -1 || de === -1) throw new Error('AIRTABLE_DATA markers not found in index.html');
  html = html.slice(0, ds) + dataBlock + html.slice(de);

  // ── 2. Inject threat table rows ──
  html = injectBetweenMarkers(html, '<!-- ENTANGLE_ROWS_START -->', '<!-- ENTANGLE_ROWS_END -->', buildEntangleRows(entangleRaw));
  html = injectBetweenMarkers(html, '<!-- SCARS_ROWS_START -->',    '<!-- SCARS_ROWS_END -->',    buildScarsRows(scarsRaw));
  html = injectBetweenMarkers(html, '<!-- VESSEL_ROWS_START -->',   '<!-- VESSEL_ROWS_END -->',   buildVesselRows(vesselRaw));

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('index.html updated successfully.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
