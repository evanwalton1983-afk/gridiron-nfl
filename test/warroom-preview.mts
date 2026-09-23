// Runs a payload through The War Room's own import pipeline (parse, validate,
// resolve) offline, with the same seeded registry its unit tests use.
// Usage (from C:/Projects/war-room so its deps resolve):
//   npx tsx ../gridiron-nfl/test/warroom-preview.mts <payload.json> <nowIso>
import { readFileSync } from 'node:fs';
import { parseEnvelope } from '../../war-room/src/lib/import/parse.ts';
import { buildPreview } from '../../war-room/src/lib/import/pipeline.ts';
import { BUILTIN_PROFILES, profileFor } from '../../war-room/src/lib/import/profiles.ts';
import { emptyExisting, seededRegistry } from '../../war-room/tests/unit/helpers.ts';

const [file, nowIso] = process.argv.slice(2);
const parsed = parseEnvelope(JSON.parse(readFileSync(file, 'utf8')));
if (!parsed.ok) { console.log(JSON.stringify({ parseErrors: parsed.errors })); process.exit(1); }
const profile = profileFor(BUILTIN_PROFILES, parsed.value.batch.source_app)!;
const p = await buildPreview({ input: parsed.value, profile, registry: seededRegistry(), now: new Date(nowIso),
  decisions: new Map(), existing: emptyExisting() });
const errors = p.rows.flatMap(r => r.errors.map(e => `${r.record?.record_id ?? r.index}: ${e.code} ${e.message}`));
const warn: Record<string, number> = {};
for (const r of p.rows) for (const w of r.warnings) warn[w.code] = (warn[w.code] ?? 0) + 1;
console.log(JSON.stringify({ counts: p.counts, errors, warnings: warn }));
process.exit(errors.length ? 1 : 0);
