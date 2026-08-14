// scripts/fetch-airtable.js
// Fetches all 6 Airtable tables and injects the data into index.html
// Run automatically by GitHub Actions — do not run manually with your token exposed.

const fs = require('fs');
const path = require('path');

const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const AT_BASE  = process.env.AIRTABLE_BASE;

if (!AT_TOKEN || !AT_BASE) {
  console.error('ERROR: AIRTABLE_TOKEN and AIRTABLE_BASE must be set as environment variables.');
  process.exit(1);
}

// ── FETCH HELPERS ──

async function fetchTable(table, sortField) {
  let url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`
    + `?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100`;
  let records = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AT_TOKEN}` }
    });
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

// ── DATA MAPPERS ──

function mapPop(records) {
  return records.map(r => ({
    y: r['Year'], lo: r['Lower Bound'], med: r['Median'], hi: r['Upper Bound']
  }));
}

function mapMon(records) {
  return records.map(r => ({
    y: r['Year'], s: r['Sightings'], u: r['Unique IDs'],
    p: r['Population Estimate'], e: r['Effort (1k km)'],
    pct: r['Percent Population Seen']
  }));
}

function mapRepro(records) {
  return records.map(r => ({
    y: r['Year'], calves: r['Calf Count'], cows: r['Available Cows'],
    pctCalved: r['Percent Calved'],
    avgI:  r['Avg Inter-Birth Interval']    ?? null,
    medI:  r['Median Inter-Birth Interval'] ?? null,
    minI:  r['Min Interval']               ?? null,
    maxI:  r['Max Interval']               ?? null,
    firstMoms: r['First-time Moms']
  }));
}

function mapRegion(records) {
  return records.map(r => ({
    name: r['Region Name'], sightings: r['Sightings'], months: r['Active Months']
  }));
}

function mapMort(records) {
  return records.map(r => ({
    y: r['Year'], ca: r['Canada'] || 0, us: r['US'] || 0
  }));
}

function mapCause(records) {
  return records.map(r => ({
    y: r['Year'],
    vs:  r['Vessel Strike']  || 0,
    ent: r['Entanglement']   || 0,
    neo: r['Neonate']        || 0,
    unk: r['Unknown']        || 0,
    oth: r['Other']          || 0
  }));
}

// ── MAIN ──

async function main() {
  console.log('Fetching data from Airtable...');

  const [popRaw, monRaw, reproRaw, regionRaw, mortRaw, causeRaw] = await Promise.all([
    fetchTable('Population Estimates', 'Year'),
    fetchTable('Annual Monitoring',    'Year'),
    fetchTable('Reproduction',         'Year'),
    fetchTable('Sightings by Region',  'Region Name'),
    fetchTable('Mortalities by Country','Year'),
    fetchTable('Mortalities by Cause', 'Year'),
  ]);

  const popData    = mapPop(popRaw);
  const monData    = mapMon(monRaw);
  const reproData  = mapRepro(reproRaw);
  const regionData = mapRegion(regionRaw);
  const mortData   = mapMort(mortRaw);
  const causeData  = mapCause(causeRaw);

  console.log(`Fetched: ${popData.length} pop, ${monData.length} mon, ${reproData.length} repro, `
    + `${regionData.length} regions, ${mortData.length} mort, ${causeData.length} cause records`);

  // Build the replacement block
  const block = `/* AIRTABLE_DATA_START */
const popData = ${JSON.stringify(popData)};

const monData = ${JSON.stringify(monData)};

const reproData = ${JSON.stringify(reproData)};

const regionData = ${JSON.stringify(regionData)};

const mortData = ${JSON.stringify(mortData)};

const causeData = ${JSON.stringify(causeData)};
/* AIRTABLE_DATA_END */`;

  // Read index.html and replace between the markers
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const startMarker = '/* AIRTABLE_DATA_START */';
  const endMarker   = '/* AIRTABLE_DATA_END */';
  const startIdx = html.indexOf(startMarker);
  const endIdx   = html.indexOf(endMarker) + endMarker.length;

  if (startIdx === -1 || endIdx === -1) {
    console.error('ERROR: Could not find AIRTABLE_DATA_START / AIRTABLE_DATA_END markers in index.html');
    process.exit(1);
  }

  html = html.slice(0, startIdx) + block + html.slice(endIdx);
  fs.writeFileSync(htmlPath, html, 'utf8');

  console.log('index.html updated successfully with fresh Airtable data.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
