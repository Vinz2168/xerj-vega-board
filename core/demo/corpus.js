// Corpus sintetico per la pagina Ricerca in demo: imita i documenti che `xerj autoindex` scrive negli indici ax-*.
// Ogni file diventa un documento «file» (body intero, symbols con line/end_line) e, per il codice, un documento per
// simbolo (title/name/kind/line/code), come fa autoindex. Il progetto «orbit» è inventato.

const FILES = [
  { path: 'src/ingest/resume.rs', language: 'rust', body: `use crate::checkpoint::{Checkpoint, CheckpointStore};
use crate::ingest::{Batch, Ingestor, IngestState};
use crate::store::SegmentStore;
use std::path::Path;

/// Resume an interrupted ingest from the last durable checkpoint.
pub async fn resume_ingest(
    ingestor: &mut Ingestor,
    store: &SegmentStore,
    checkpoint_path: impl AsRef<Path>,
) -> Result<IngestState, IngestError> {
    // Load the last checkpoint if it exists
    let checkpoint = CheckpointStore::load(checkpoint_path.as_ref()).await?;

    // Restore the ingest state and continue from where it left off
    ingestor.restore(&checkpoint).await?;
    ingestor.run(store).await
}

/// Skip every batch the checkpoint already covers.
pub fn pending_batches<'a>(all: &'a [Batch], cp: &Checkpoint) -> &'a [Batch] {
    let done = all.iter().take_while(|b| b.seq <= cp.last_seq).count();
    &all[done..]
}
` },
  { path: 'src/ingest/checkpoint.rs', language: 'rust', body: `use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

/// What a resumed ingest needs to know: the last batch made durable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub last_seq: u64,
    pub docs: u64,
    pub written_at: i64,
}

pub struct CheckpointStore;

impl CheckpointStore {
    /// Read the checkpoint; a missing file means "start from zero".
    pub async fn load(path: &Path) -> Result<Checkpoint, IngestError> {
        match fs::read(path).await {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Checkpoint { last_seq: 0, docs: 0, written_at: 0 }),
            Err(e) => Err(e.into()),
        }
    }

    /// Write to a temporary file, fsync, then rename: a crash never leaves half a checkpoint.
    pub async fn save(path: &Path, cp: &Checkpoint) -> Result<(), IngestError> {
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, serde_json::to_vec(cp)?).await?;
        fs::File::open(&tmp).await?.sync_all().await?;
        fs::rename(&tmp, path).await?;
        Ok(())
    }
}
` },
  { path: 'src/store/segment.rs', language: 'rust', body: `use std::collections::BTreeMap;

/// Immutable, sorted run of documents written by one flush.
pub struct Segment {
    pub id: u64,
    pub docs: BTreeMap<String, Vec<u8>>,
}

pub struct SegmentStore {
    segments: Vec<Segment>,
    next_id: u64,
}

impl SegmentStore {
    pub fn new() -> Self { Self { segments: Vec::new(), next_id: 1 } }

    /// Flush a batch as a new segment and return its id.
    pub fn flush(&mut self, docs: BTreeMap<String, Vec<u8>>) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.segments.push(Segment { id, docs });
        id
    }

    /// Merge the two smallest segments; newer documents win on duplicate ids.
    pub fn merge_smallest(&mut self) {
        if self.segments.len() < 2 { return; }
        self.segments.sort_by_key(|s| s.docs.len());
        let b = self.segments.remove(1);
        let a = &mut self.segments[0];
        for (k, v) in b.docs { a.docs.insert(k, v); }
    }
}
` },
  { path: 'src/dedup.rs', language: 'rust', body: `use std::collections::HashSet;
use xxhash_rust::xxh3::xxh3_128;

/// Content fingerprint: the same bytes always give the same id.
pub fn fingerprint(body: &[u8]) -> u128 {
    xxh3_128(body)
}

/// Drop documents whose fingerprint was already seen in this run.
pub fn dedup(docs: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut seen = HashSet::new();
    docs.into_iter().filter(|d| seen.insert(fingerprint(d))).collect()
}
` },
  { path: 'tools/bench_ingest.py', language: 'python', body: `"""Measure ingest throughput against a running node."""
import json
import time
import urllib.request


def bulk_body(n, start=0):
    lines = []
    for i in range(start, start + n):
        lines.append(json.dumps({"index": {"_id": str(i)}}))
        lines.append(json.dumps({"msg": f"event {i}", "n": i}))
    return "\\n".join(lines) + "\\n"


def run(url, total=100_000, batch=5_000):
    t0 = time.time()
    for start in range(0, total, batch):
        req = urllib.request.Request(url + "/bench/_bulk", data=bulk_body(batch, start).encode(),
                                     headers={"content-type": "application/x-ndjson"})
        urllib.request.urlopen(req).read()
    dt = time.time() - t0
    print(f"{total} docs in {dt:.1f}s = {total / dt:.0f} docs/s")


if __name__ == "__main__":
    run("http://localhost:9200")
` },
  { path: 'web/src/searchClient.js', language: 'javascript', body: `// Minimal client used by the web console.

export async function search(url, index, text, size = 10) {
  const body = { size, query: { multi_match: { query: text, fields: ['title^2', 'body'] } } };
  const res = await fetch(url + '/' + index + '/_search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()).hits.hits;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export class QueryHistory {
  constructor(max = 20) { this.max = max; this.items = []; }
  push(q) { this.items = [q, ...this.items.filter(x => x !== q)].slice(0, this.max); }
}
` },
  { path: 'docs/checkpointing.md', language: 'markdown', format: 'txt-prose', body: `# Checkpointing and resumable ingest

An ingest run can be interrupted at any point: a crash, a deploy, a laptop lid.
Orbit writes a checkpoint after every batch that reached durable storage, so a
restarted run continues from the next batch instead of starting over.

## What the checkpoint holds

The checkpoint is a small JSON file with the sequence number of the last durable
batch, the document count and the time it was written. It is replaced atomically:
written to a temporary file, synced to disk, then renamed over the old one.

## Resuming

\`resume_ingest\` loads the checkpoint, restores the ingestor state and skips
every batch whose sequence number is not greater than \`last_seq\`. A missing
checkpoint file means the run starts from zero.
` },
  { path: 'docs/storage.md', language: 'markdown', format: 'txt-prose', body: `# Storage format

Documents are written in segments: immutable, sorted runs produced by one flush.
Segments are merged in the background, smallest first, so the number of files
stays bounded while ingest continues.

Duplicate documents are dropped before they reach a segment: each body is
fingerprinted with xxh3-128 and a fingerprint already seen in the run is skipped.
` },
  { path: 'README.md', language: 'markdown', format: 'txt-prose', body: `# Orbit

A small, local search engine used to show XERJ Vega Board's Search page in demo mode.

- Resumable ingest with atomic checkpoints (see docs/checkpointing.md)
- Segment storage with background merges (see docs/storage.md)
- Content deduplication with xxh3 fingerprints
` },
  { path: 'config/orbit.json', language: 'json', format: 'json', body: `{
  "ingest": { "batch_size": 5000, "checkpoint": "data/ingest.checkpoint" },
  "store": { "merge_policy": "smallest-first", "max_segments": 32 }
}
` }
];

// dichiarazioni riconosciute, per linguaggio: [regex sulla riga, kind]
const DECL = {
  rust: [[/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, 'function'], [/^\s*(?:pub\s+)?struct\s+(\w+)/, 'struct'], [/^\s*impl\s+(\w+)/, 'impl']],
  python: [[/^def\s+(\w+)/, 'function'], [/^class\s+(\w+)/, 'class']],
  javascript: [[/^export\s+(?:async\s+)?function\s+(\w+)/, 'function'], [/^export\s+class\s+(\w+)/, 'class']]
};

/** Fine di una dichiarazione: la riga che chiude le graffe aperte (o, per Python, la fine del blocco indentato). */
function endOf(lines, i, lang) {
  if (lang === 'python') { let j = i + 1; while (j < lines.length && (lines[j] === '' || /^\s/.test(lines[j]))) j++; while (j > i + 1 && lines[j - 1] === '') j--; return j; }
  let depth = 0, open = false;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') { depth++; open = true; } else if (ch === '}') depth--; }
    if (open && depth <= 0) return j + 1;
    if (!open && /;\s*$/.test(lines[j])) return j + 1;
  }
  return lines.length;
}

export const CORPUS_MAP = {
  ax_path: { type: 'keyword' }, ax_file: { type: 'keyword' }, ax_locator: { type: 'keyword' }, ax_dataset: { type: 'keyword' }, ax_format: { type: 'keyword' },
  path: { type: 'keyword' }, language: { type: 'keyword' }, kind: { type: 'keyword' }, name: { type: 'keyword' },
  title: { type: 'text' }, body: { type: 'text' }, code: { type: 'text' }, defs: { type: 'text' },
  line: { type: 'long' }, end_line: { type: 'long' }, symbol_count: { type: 'long' },
  symbols: { properties: { name: { type: 'keyword' }, kind: { type: 'keyword' }, line: { type: 'long' }, end_line: { type: 'long' } } }
};

/** Documenti dell'indice ax-orbit (senza _id: lo assegna data.js). */
export function corpusDocs() {
  const out = [];
  FILES.forEach((f, n) => {
    const file = 'axf-demo-' + n, lines = f.body.split('\n'), symbols = [];
    for (const [i, l] of lines.entries()) for (const [re, kind] of DECL[f.language] || []) {
      const m = l.match(re); if (m) symbols.push({ name: m[1], kind, line: i + 1, end_line: endOf(lines, i, f.language) });
    }
    const base = { ax_path: f.path, ax_file: file, ax_dataset: 'orbit', ax_format: f.format || 'code', path: f.path.split('/').pop(), language: f.language };
    const title = f.format === 'txt-prose' ? (lines[0] || f.path) : f.path.split('/').pop();
    out.push({ ...base, ax_locator: f.format ? 'text' : 'code', title, body: f.body,
      ...(symbols.length ? { symbols, symbol_count: symbols.length, defs: symbols.map(s => s.kind + ' ' + s.name).join('\n') } : {}) });
    for (const s of symbols) out.push({ ...base, ax_locator: `code:${s.line}:${s.name}`, title: s.name, name: s.name, kind: s.kind, line: s.line, code: lines[s.line - 1].trim() });
  });
  return out;
}
