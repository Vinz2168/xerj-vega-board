// Agent Memory in demo: lo stesso contratto di /_memory su XERJ (engine/crates/xerj-api/src/memory_api.rs), su namespace sintetici in RAM.
// Scrive davvero (store, forget) ma solo per la vita della pagina: ricaricando si torna agli esempi.
//   GET    /_memory/{ns}?from&size   → { namespace, exists, count, entries: [{ id, text, metadata, score }], from, size, next }
//   POST   /_memory/{ns}/_recall     → { hits: [{ id, text, metadata, score }] }   (query, semantic, hybrid, k)
//   POST   /_memory/{ns}             → { id, created }
//   DELETE /_memory/{ns}/{id}        → { id, namespace, forgotten }
// Il richiamo è un punteggio di termini in comune (BM25 «povero»): semantic e hybrid usano lo stesso, la demo non ha embedding.

const SEED = {
  'support-bot': [
    ['The customer prefers answers in Italian and short bullet points.', { kind: 'preference', user: 'u-1042' }],
    ['Refunds above 500 EUR need approval from the finance team.', { kind: 'policy' }],
    ['Order ax-77120 was delayed by the carrier; a 10% voucher was offered.', { kind: 'event', order: 'ax-77120' }],
    ['Password resets are self-service at /account/reset; never send a password by email.', { kind: 'policy' }],
    ['The mobile app crash on Android 15 is fixed in release 4.2.1.', { kind: 'fact', product: 'mobile' }],
    ['User u-2210 asked twice about invoice duplicates; escalate if it happens again.', { kind: 'event', user: 'u-2210' }],
    ['Shipping to Switzerland takes 3 to 5 business days and includes customs fees.', { kind: 'fact' }],
    ['Weekend support hours are 9:00-13:00 CET.', { kind: 'fact' }]
  ],
  'code-agent': [
    ['Resumable indexing lives in core/src/indexer/resume.rs: it loads the last checkpoint and restores the indexer state.', { kind: 'code', file: 'resume.rs' }],
    ['Checkpoints are written by checkpoint.rs every 10,000 documents and on shutdown.', { kind: 'code', file: 'checkpoint.rs' }],
    ['The storage layer (store.rs) keeps documents and checkpoint state in the same segment files.', { kind: 'code', file: 'store.rs' }],
    ['Run the tests with cargo test -p xerj-engine; the integration tests need --features it.', { kind: 'howto' }],
    ['Deduplication compares a 64-bit simhash of the text before indexing.', { kind: 'code', file: 'dedup.rs' }],
    ['The team prefers small PRs with one behaviour change each.', { kind: 'preference' }],
    ['_msearch with a wildcard index in the header returned 404 until PR #1939.', { kind: 'fact', issue: '#1932' }]
  ]
};

let spaces = null;
const now = Date.now();
function init() {
  if (spaces) return spaces;
  spaces = new Map();
  for (const [ns, list] of Object.entries(SEED)) {
    // le più vecchie prima: stored_at cresce, l'elenco le mostra dalla più recente
    spaces.set(ns, list.map(([text, metadata], i) => ({ id: ns.slice(0, 3) + '-' + String(i + 1).padStart(3, '0'), text, metadata, stored_at: now - (list.length - i) * 37 * 6e4 })));
  }
  return spaces;
}

const words = s => String(s || '').toLowerCase().match(/[\p{L}\p{N}_.#-]{2,}/gu) || [];
const entry = (e, score = null) => ({ id: e.id, text: e.text, metadata: e.metadata ?? null, score });
const validNs = ns => /^[a-z0-9][a-z0-9_.-]{0,199}$/.test(ns);

/** Rotte /_memory della demo. `seg` = segmenti del percorso già decodificati, il primo è "_memory". */
export function memoryRoute(M, seg, params, body) {
  const err = (status, type, reason) => ({ status, body: { error: { type, reason }, status } });
  const ns = seg[1], all = init();
  if (!ns) return err(400, 'illegal_argument_exception', 'missing namespace: /_memory/{namespace}');
  if (!validNs(ns)) return err(400, 'illegal_argument_exception', 'namespace must match [a-z0-9][a-z0-9_.-]*');
  const list = all.get(ns);

  if (seg.length === 2 && M === 'GET') {
    const from = Math.max(0, +(params.get('from') ?? params.get('after') ?? 0) || 0), size = Math.min(1000, Math.max(1, +params.get('size') || 100));
    if (!list) return { status: 200, body: { namespace: ns, exists: false, count: 0, entries: [], from, size, next: null } };
    const sorted = [...list].sort((a, b) => b.stored_at - a.stored_at), page = sorted.slice(from, from + size);
    return { status: 200, body: { namespace: ns, exists: true, count: list.length, entries: page.map(e => entry(e)), from, size, next: from + page.length < list.length ? { from: from + page.length, size } : null } };
  }
  if (seg.length === 2 && M === 'POST') {
    const b = body || {};
    if (!b.text) return err(400, 'illegal_argument_exception', 'a memory must have non-empty `text` or a `vector`');
    const l = list || (all.set(ns, []), all.get(ns));
    const id = b.id || 'mem-' + Math.random().toString(36).slice(2, 10);
    const i = l.findIndex(e => e.id === id), e = { id, text: String(b.text), metadata: b.metadata ?? null, stored_at: Date.now() };
    if (i >= 0) l[i] = e; else l.push(e);
    return { status: 200, body: { id, created: i < 0 } };
  }
  if (seg.length === 3 && seg[2] === '_recall' && (M === 'POST' || M === 'GET')) {
    const b = body || {}, k = Math.max(1, Math.min(100, +b.k || 10));
    if ((b.semantic || b.hybrid) && !String(b.query || '').trim()) return err(400, 'illegal_argument_exception', 'semantic/hybrid recall requires a non-empty `query`');
    if (b.vector) return err(400, 'demo_unsupported', 'recall by vector is not available in the demo (no embeddings)');
    const q = words(b.query);
    const scored = (list || []).map(e => { const w = words(e.text + ' ' + JSON.stringify(e.metadata || {})); return [e, q.length ? q.filter(t => w.some(x => x.startsWith(t))).length / q.length : 1]; })
      .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || b[0].stored_at - a[0].stored_at).slice(0, k);
    return { status: 200, body: { hits: scored.map(([e, s]) => entry(e, Math.round(s * 1000) / 1000)) } };
  }
  if (seg.length === 3 && M === 'DELETE') {
    const i = (list || []).findIndex(e => e.id === seg[2]);
    if (i < 0) return { status: 404, body: { id: seg[2], namespace: ns, forgotten: false } };
    list.splice(i, 1);
    return { status: 200, body: { id: seg[2], namespace: ns, forgotten: true } };
  }
  if (seg.length === 2 && M === 'DELETE') return err(405, 'demo_read_only', 'dropping a namespace is not available in the demo');
  return err(400, 'demo_unsupported', 'endpoint not available in the demo: ' + M + ' /' + seg.join('/'));
}

/** Namespace di esempio (la pagina li propone in demo; su XERJ non c'è un endpoint che li elenchi). */
export const demoNamespaces = () => [...init().keys()];
