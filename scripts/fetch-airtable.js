// scripts/fetch-airtable.js
// Fetches all 9 Airtable tables and writes data.js alongside index.html
// Run by GitHub Actions on schedule — token is stored as a GitHub Secret, never in HTML.

const fs   = require('fs');
const path = require('path');

const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const AT_BASE  = process.env.AIRTABLE_BASE;

if (!AT_TOKEN || !AT_BASE) {
  console.error('ERROR: AIRTABLE_TOKEN and AIRTABLE_BASE must be set as environment variables.');
  process.exit(1);
}

// ── FETCH ──
async function fetchTable(table, sortField) {
  let url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`
    + `?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100`;
  let records = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AT_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable error on "${table}": ${res.status} ${res.statusText}`);
    const json = await res.json();
    records = records.concat(json.records.map(r => r.fields));
    url = json.offset
      ? `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`
        + `?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100&offset=${json.offset}`
      : null;
  }
  return records;
}

// ── DATE FORMATTER ──
function fmtDate(val) {
  if (!val) return '—';
  const p = val.split('-');
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : val;
}

// ── MAPPERS ──
const mapPop    = r => ({ y:r['Year'], lo:r['Lower Bound'], med:r['Median'], hi:r['Upper Bound'] });
const mapMon    = r => ({ y:r['Year'], s:r['Sightings'], u:r['Unique IDs'], p:r['Population Estimate'], e:r['Effort (1k km)'], pct:r['Percent Population Seen'] });
const mapRepro  = r => ({ y:r['Year'], calves:r['Calf Count'], cows:r['Available Cows'], pctCalved:r['Percent Calved'], avgI:r['Avg Inter-Birth Interval']??null, medI:r['Median Inter-Birth Interval']??null, minI:r['Min Interval']??null, maxI:r['Max Interval']??null, firstMoms:r['First-time Moms'] });
const mapRegion = r => ({ name:r['Region Name'], sightings:r['Sightings'], months:r['Active Months'] });
const mapMort   = r => ({ y:r['Year'], ca:r['Canada']||0, us:r['US']||0 });
const mapCause  = r => ({ y:r['Year'], vs:r['Vessel Strike']||0, ent:r['Entanglement']||0, neo:r['Neonate']||0, unk:r['Unknown']||0, oth:r['Other']||0 });

// ── HTML ROW BUILDERS ──
const rowStyle = 'font-size:0.78rem;color:rgba(240,236,227,0.75)';

function entangleRows(records) {
  return records.map(r =>
    `<tr><td><strong style="color:var(--amber)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Entanglement Sighting'])}</td>` +
    `<td>${r['Pre-Entanglement Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['First Sighting'])}</td>` +
    `<td>${r['Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="${rowStyle}">${r['Status/Details']||'—'}</span></td></tr>`
  ).join('\n');
}

function scarsRows(records) {
  return records.map(r =>
    `<tr><td><strong style="color:var(--amber)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Injury Date'])}</td>` +
    `<td>${r['Pre-Injury Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['Injury Detection Date'])}</td>` +
    `<td>${r['Detection Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="${rowStyle}">${r['Status/Details']||'—'}</span></td></tr>`
  ).join('\n');
}

function vesselRows(records) {
  return records.map(r =>
    `<tr><td><strong style="color:var(--coral)">${r['Whale ID']||'—'}</strong></td>` +
    `<td class="num">${fmtDate(r['Pre-Injury Date'])}</td>` +
    `<td>${r['Pre-Injury Location']||'—'}</td>` +
    `<td class="num">${fmtDate(r['Injury Detection Date'])}</td>` +
    `<td>${r['Detection Location']||'—'}</td>` +
    `<td>${r['Sex']||'—'}</td>` +
    `<td>${r['Age']||'—'}</td>` +
    `<td><span style="${rowStyle}">${r['Status/Details']||'—'}</span></td></tr>`
  ).join('\n');
}

// ── MAIN ──
async function main() {
  console.log('Fetching all 9 tables from Airtable...');

  const [popRaw, monRaw, reproRaw, regionRaw, mortRaw, causeRaw,
         entangleRaw, scarsRaw, vesselRaw] = await Promise.all([
    fetchTable('Population Estimates',       'Year'),
    fetchTable('Annual Monitoring',          'Year'),
    fetchTable('Reproduction',               'Year'),
    fetchTable('Sightings by Region',        'Region Name'),
    fetchTable('Mortalities by Country',     'Year'),
    fetchTable('Mortalities by Cause',       'Year'),
    fetchTable('Active Entanglement Cases',  'First Sighting'),
    fetchTable('Entanglement Scars Only',    'Injury Detection Date'),
    fetchTable('Vessel Strike Cases',        'Injury Detection Date'),
  ]);

  console.log(`Fetched: ${popRaw.length} pop, ${monRaw.length} mon, ${reproRaw.length} repro, `
    + `${regionRaw.length} regions, ${mortRaw.length} mort, ${causeRaw.length} cause, `
    + `${entangleRaw.length} entangle, ${scarsRaw.length} scars, ${vesselRaw.length} vessel`);

  // Write data.js — loaded by index.html via <script src="data.js">
  const dataJs = `// data.js — auto-generated by GitHub Actions. Do not edit manually.
// Last updated: ${new Date().toISOString()}

var popData    = ${JSON.stringify(popRaw.map(mapPop))};
var monData    = ${JSON.stringify(monRaw.map(mapMon))};
var reproData  = ${JSON.stringify(reproRaw.map(mapRepro))};
var regionData = ${JSON.stringify(regionRaw.map(mapRegion))};
var mortData   = ${JSON.stringify(mortRaw.map(mapMort))};
var causeData  = ${JSON.stringify(causeRaw.map(mapCause))};
`;

  const dataPath = path.join(__dirname, '..', 'data.js');
  fs.writeFileSync(dataPath, dataJs, 'utf8');
  console.log('data.js written successfully.');

  // Inject threat table rows directly into index.html tbodies
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  function inject(h, start, end, content) {
    const si = h.indexOf(start);
    const ei = h.indexOf(end);
    if (si === -1 || ei === -1) { console.warn(`Warning: markers not found: ${start}`); return h; }
    return h.slice(0, si + start.length) + '\n' + content + '\n' + h.slice(ei);
  }

  html = inject(html, '<!-- ENTANGLE_ROWS_START -->', '<!-- ENTANGLE_ROWS_END -->', entangleRows(entangleRaw));
  html = inject(html, '<!-- SCARS_ROWS_START -->',    '<!-- SCARS_ROWS_END -->',    scarsRows(scarsRaw));
  html = inject(html, '<!-- VESSEL_ROWS_START -->',   '<!-- VESSEL_ROWS_END -->',   vesselRows(vesselRaw));

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('index.html threat table rows updated.');
  console.log('Done.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
