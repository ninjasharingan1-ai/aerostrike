import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_ASSET_MANIFEST, VISUAL_ASSET_MANIFEST, AssetManifestRecord } from '../src/assets/assetManifest';

const OUT_DIR = path.resolve(process.cwd(), 'public/assets/manifests');
fs.mkdirSync(OUT_DIR, { recursive: true });

function csvEscape(val: string | number | null): string {
  const s = val === null ? '' : String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

function enrichWithFileMeta(records: AssetManifestRecord[]) {
  return records.map((r) => {
    let existsOnDisk = false;
    let byteLength = 0;
    if (r.localPath) {
      const diskPath = r.localPath.startsWith('/public/')
        ? path.resolve(process.cwd(), r.localPath.slice(1))
        : path.resolve(process.cwd(), 'public', r.localPath.replace(/^\//, ''));
      if (fs.existsSync(diskPath)) {
        existsOnDisk = true;
        byteLength = fs.statSync(diskPath).size;
      }
    }
    return {
      ...r,
      existsOnDisk,
      byteLength,
    };
  });
}

function toCsv(rows: ReturnType<typeof enrichWithFileMeta>): string {
  const headers = [
    'id',
    'category',
    'name',
    'status',
    'license',
    'creatorOrOrigin',
    'localPath',
    'existsOnDisk',
    'byteLength',
    'format',
    'sourceUrl',
    'notes',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.category,
        row.name,
        row.status,
        row.license,
        row.creatorOrOrigin,
        row.localPath,
        row.existsOnDisk ? 'true' : 'false',
        row.byteLength,
        row.format,
        row.sourceUrl,
        row.notes,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

const visualRows = enrichWithFileMeta(VISUAL_ASSET_MANIFEST);
const audioRows = enrichWithFileMeta(AUDIO_ASSET_MANIFEST);

fs.writeFileSync(
  path.join(OUT_DIR, 'visual_asset_manifest.json'),
  JSON.stringify({ stage: 'Stage A', generatedAt: new Date().toISOString(), assets: visualRows }, null, 2),
);
fs.writeFileSync(path.join(OUT_DIR, 'visual_asset_manifest.csv'), toCsv(visualRows));

fs.writeFileSync(
  path.join(OUT_DIR, 'audio_asset_manifest.json'),
  JSON.stringify({ stage: 'Stage A', generatedAt: new Date().toISOString(), assets: audioRows }, null, 2),
);
fs.writeFileSync(path.join(OUT_DIR, 'audio_asset_manifest.csv'), toCsv(audioRows));

console.log(`Wrote visual manifest (${visualRows.length} entries) and audio manifest (${audioRows.length} entries) to ${OUT_DIR}`);
