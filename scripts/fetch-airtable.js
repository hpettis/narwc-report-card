// scripts/fetch-airtable.js — writes data.js only, never touches index.html
const fs = require('fs');
const path = require('path');
const AT_TOKEN = process.env.AIRTABLE_TOKEN;
const AT_BASE  = process.env.AIRTABLE_BASE;
if (!AT_TOKEN || !AT_BASE) { console.error('Missing env vars'); process.exit(1); }

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTable(table, sortField, retries = 3) {
  let url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}?sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc&pageSize=100`;
  let records = [];
  while (url) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${AT_TOKEN}` } });
        if (res.status === 429) {
          const wait = attempt * 2000;
          console.log(`Rate limited on "${table}" — waiting ${wait}ms before retry ${attempt}/${retries}`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`${table}: ${res.status}`);
        const json = await res.json();
        records = records.concat(json.records.map(r => r.fields));
        url = json.offset ? url.split('&offset')[0] + `&offset=${json.offset}` : null;
        lastErr = null;
        break;
      } catch(err) {
        lastErr = err;
        if (attempt < retries) await sleep(attempt * 2000);
      }
    }
    if (lastErr) throw lastErr;
  }
  return records;
}

// Airtable can return strings, numbers, arrays (lookups/links) or objects depending on field type
function str(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(str).join(', ');
  if (typeof v === 'object') return v.name || v.value || '';
  return String(v);
}
function esc(v) { return str(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(val) {
  const v = str(val).trim();
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);   // ISO date or datetime
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;        // otherwise keep the text as typed
}

const mapPop    = r => ({y:r['Year'],lo:r['Lower Bound'],med:r['Median'],hi:r['Upper Bound']});
const mapMon    = r => ({y:r['Year'],s:r['Sightings'],u:r['Unique IDs'],p:r['Population Estimate'],e:r['Effort (1k km)'],pct:r['Percent Population Seen']});
const mapRepro  = r => ({y:r['Year'],calves:r['Calf Count'],cows:r['Available Cows'],pctCalved:r['Percent Calved'],avgI:r['Avg Inter-Birth Interval']??null,medI:r['Median Inter-Birth Interval']??null,minI:r['Min Interval']??null,maxI:r['Max Interval']??null,firstMoms:r['First-time Moms']});
const mapRegion = r => ({name:r['Region Name'],sightings:r['Sightings'],months:r['Active Months']});
const mapMort   = r => ({y:r['Year'],ca:r['Canada']||0,us:r['US']||0});
const mapCause  = r => ({y:r['Year'],vs:r['Vessel Strike']||0,ent:r['Entanglement']||0,neo:r['Neonate']||0,unk:r['Unknown']||0,oth:r['Other']||0});

const rs = 'font-size:0.78rem;color:rgba(240,236,227,0.75)';
const entangleRows = recs => recs.map(r =>
  `<tr><td><strong style="color:var(--amber)">${esc(r['Whale ID'])}</strong></td>` +
  `<td class="num">${fmtDate(r['Pre-Entanglement Sighting'])}</td><td>${esc(r['Pre-Entanglement Location'])}</td>` +
  `<td class="num">${fmtDate(r['First Sighting'])}</td><td>${esc(r['Location'])}</td>` +
  `<td>${esc(r['Sex'])}</td><td>${esc(r['Age'])}</td>` +
  `<td><span style="${rs}">${esc(r['Status/Details'])}</span></td></tr>`).join('');

const scarsRows = recs => recs.map(r =>
  `<tr><td><strong style="color:var(--amber)">${esc(r['Whale ID'])}</strong></td>` +
  `<td class="num">${fmtDate(r['Pre-Entanglement Date']||r['Pre-Injury Date'])}</td><td>${esc(r['Pre-Injury Location'])}</td>` +
  `<td class="num">${fmtDate(r['Injury Detection Date'])}</td><td>${esc(r['Detection Location'])}</td>` +
  `<td>${esc(r['Sex'])}</td><td>${esc(r['Age'])}</td>` +
  `<td><span style="${rs}">${esc(r['Status/Details'])}</span></td></tr>`).join('');

const vesselRows = recs => recs.map(r =>
  `<tr><td><strong style="color:var(--amber)">${esc(r['Whale ID'])}</strong></td>` +
  `<td class="num">${fmtDate(r['Pre-Injury Date'])}</td><td>${esc(r['Pre-Injury Location'])}</td>` +
  `<td class="num">${fmtDate(r['Injury Detection Date'])}</td><td>${esc(r['Detection Location'])}</td>` +
  `<td>${esc(r['Sex'])}</td><td>${esc(r['Age'])}</td>` +
  `<td><span style="${rs}">${esc(r['Status/Details'])}</span></td></tr>`).join('');

async function main() {
  console.log('Fetching all 9 tables from Airtable...');

  // Initial wait to avoid hitting rate limit from recent activity
  await sleep(1000);

  const popR    = await fetchTable('Population Estimates',      'Year');             await sleep(500);
  const monR    = await fetchTable('Annual Monitoring',         'Year');             await sleep(500);
  const reproR  = await fetchTable('Reproduction',              'Year');             await sleep(500);
  const regionR = await fetchTable('Sightings by Region',       'Region Name');     await sleep(500);
  const mortR   = await fetchTable('Mortalities by Country',    'Year');             await sleep(500);
  const causeR  = await fetchTable('Mortalities by Cause',      'Year');             await sleep(500);
  const entR    = await fetchTable('Active Entanglement Cases', 'First Sighting');   await sleep(500);
  const scR     = await fetchTable('Entanglement Scars Only',   'Injury Detection Date'); await sleep(500);
  const vsR     = await fetchTable('Vessel Strike Cases',       'Injury Detection Date');

  console.log(`Fetched: ${popR.length} pop, ${monR.length} mon, ${reproR.length} repro, ${regionR.length} regions, ${mortR.length} mort, ${causeR.length} cause, ${entR.length} entangle, ${scR.length} scars, ${vsR.length} vessel`);

  if (entR.length) console.log('Active Entanglement fields found:', Object.keys(entR[0]).join(' | '));
  if (!entR.length) console.log('WARNING: Active Entanglement Cases returned 0 records');

  const dataJs = `// data.js — auto-generated by GitHub Actions from Airtable. Do not edit.
// Last updated: ${new Date().toISOString()}
var popData    = ${JSON.stringify(popR.map(mapPop))};
var monData    = ${JSON.stringify(monR.map(mapMon))};
var reproData  = ${JSON.stringify(reproR.map(mapRepro))};
var regionData = ${JSON.stringify(regionR.map(mapRegion))};
var mortData   = ${JSON.stringify(mortR.map(mapMort))};
var causeData  = ${JSON.stringify(causeR.map(mapCause))};
var entangleHTML = ${JSON.stringify(entangleRows(entR))};
var scarsHTML    = ${JSON.stringify(scarsRows(scR))};
var vesselHTML   = ${JSON.stringify(vesselRows(vsR))};
`;

  fs.writeFileSync(path.join(__dirname, '..', 'data.js'), dataJs, 'utf8');
  console.log('data.js written. index.html NOT modified.');
}
main().catch(err => { console.error('Failed:', err); process.exit(1); });
