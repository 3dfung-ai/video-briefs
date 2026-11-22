/**
 * Video Briefs sync: keeps the shared copy of your Video Briefs library in your own Google Drive.
 *
 *   Folder : My Drive / 00_Apps / Video Briefs /
 *     index.json   the list of briefs, each with a revision number
 *     _data/       one JSON file per brief (card, brief, transcript, questions). Leave alone.
 *     Briefs/      a readable Markdown copy of every finished brief (open it anywhere: UpNote, Claude, NotebookLM)
 *     backups/     daily copies of index.json (newest 40 kept; older ones go to Drive Trash)
 *
 * One-time setup
 *   1. Run "setup" once (Run button). Allow access when Google asks.
 *   2. Copy the sync key from the Execution log.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *   4. Paste the Web app link (ends in /exec) and the key into Video Briefs > Settings > Drive sync.
 *
 * The script answers only requests that carry your sync key. The key, and your Gemini API key if you
 * choose to keep it here for your other devices, live in this script's properties, never in the public page.
 *
 * A device sends a changed brief with the revision it was based on. If another device changed that brief
 * in the meantime, the script refuses the write and returns the current copy so the device can merge it.
 * Deleting a brief forever moves its files to Drive Trash (recoverable for 30 days), never straight to oblivion.
 */
var APP = 'videobriefs-sync', VERSION = 1;
var FOLDERS = ['00_Apps', 'Video Briefs'];
var INDEX = 'index.json', DATA = '_data', MD = 'Briefs', BACKUP = 'backups';
var KEEP_BACKUPS = 40, AUTO_BACKUP_HOURS = 20;
var MAX_BYTES = 3500000, MAX_MS = 20000;

function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_KEY', key);
  }
  var root = root_();
  sub_(root, DATA); sub_(root, MD); sub_(root, BACKUP);
  var idx = indexFile_(root);
  Logger.log('Video Briefs sync is ready.');
  Logger.log('Sync key: ' + key);
  Logger.log('Folder: ' + root.getUrl());
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Paste the Web app link and this key into Video Briefs.');
  return idx.getUrl();
}

/* Run this only if a setup link was shared by mistake. Every device then needs the new key. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_KEY');
  setup();
}

function doGet() {
  return json_({ ok: true, app: APP, v: VERSION, note: 'Video Briefs sync is running. Use this link inside Video Briefs.' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key || !req || typeof req.key !== 'string' || req.key !== key) return json_({ ok: false, error: 'bad_key' });
  if (req.op === 'ping') return json_({ ok: true, app: APP, v: VERSION });
  if (req.op === 'config') return json_(config_(req, props));

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'busy' });
  try {
    if (req.op === 'sync') return json_(sync_(req));
    if (req.op === 'info') return json_(info_());
    return json_({ ok: false, error: 'bad_op' });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

/* The Gemini key, kept here so a newly connected device can pick it up. */
function config_(req, props) {
  if (req.set && typeof req.set === 'object') {
    if (typeof req.set.gemini === 'string') {
      var g = req.set.gemini.trim();
      if (g) props.setProperty('GEMINI_KEY', g.slice(0, 200)); else props.deleteProperty('GEMINI_KEY');
    }
    if (typeof req.set.model === 'string') props.setProperty('GEMINI_MODEL', req.set.model.slice(0, 80));
  }
  return { ok: true, gemini: props.getProperty('GEMINI_KEY') || '', model: props.getProperty('GEMINI_MODEL') || '' };
}

/* ---------- sync ---------- */
function sync_(req) {
  var t0 = Date.now();
  var root = root_();
  var idxFile = indexFile_(root);
  var store = readIndex_(idxFile);
  var recs = store.records;
  var now = Date.now();
  var device = String(req.device || '').slice(0, 60);
  var changes = Array.isArray(req.changes) ? req.changes : [];
  var accepted = [], conflicts = [], apply = [], done = {};

  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i];
    if (!ch || typeof ch.id !== 'string' || !ch.id || ch.id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(ch.id) || done[ch.id]) continue;
    done[ch.id] = true;
    if (!ch.purge && (!ch.data || typeof ch.data !== 'object' || ch.data.id !== ch.id)) continue;
    var cur = recs[ch.id];
    var base = ch.baseRev === undefined ? null : ch.baseRev;
    if (cur && cur.rev !== base && !(cur.purged && ch.purge)) {
      conflicts.push({ id: ch.id, rev: cur.rev, purged: !!cur.purged, device: cur.device || '', data: cur.purged ? null : readData_(cur) });
      continue;
    }
    if (!cur && ch.purge) { accepted.push({ id: ch.id, rev: null }); continue; }
    apply.push(ch);
  }

  if (apply.length) {
    var due = !store.lastBackupAt || now - store.lastBackupAt > AUTO_BACKUP_HOURS * 3600 * 1000;
    if (due && Object.keys(recs).length) { backup_(idxFile, root); store.lastBackupAt = now; }
    var dataDir = sub_(root, DATA), mdDir = sub_(root, MD);
    for (var j = 0; j < apply.length; j++) {
      var c = apply[j], r = recs[c.id] || {};
      store.rev += 1;
      if (c.purge) {
        trash_(r.fid); trash_(r.mid);
        recs[c.id] = { rev: store.rev, updated: now, device: device, purged: true };
      } else {
        var text = JSON.stringify(c.data);
        var fid = write_(dataDir, r.fid, c.id + '.json', text, 'application/json');
        var mid = r.mid || '';
        if (typeof c.md === 'string') {
          if (c.md) mid = write_(mdDir, r.mid, String(c.mdName || (c.id + '.md')).slice(0, 180), c.md, 'text/markdown');
          else { trash_(r.mid); mid = ''; }
        }
        recs[c.id] = { rev: store.rev, updated: now, device: device, purged: false, fid: fid, mid: mid, size: text.length,
          title: String(c.data.title || '').slice(0, 120), status: String(c.data.status || ''), deleted: !!c.data.deleted_at };
      }
      accepted.push({ id: c.id, rev: store.rev });
    }
    store.savedAt = new Date(now).toISOString();
    store.savedBy = device;
    idxFile.setContent(JSON.stringify(store));
  }

  var have = req.have && typeof req.have === 'object' ? req.have : {};
  var skip = {};
  accepted.forEach(function (a) { skip[a.id] = true; });
  conflicts.forEach(function (c) { skip[c.id] = true; });
  var updates = [], bytes = 0, more = false, unreadable = [];
  var ids = Object.keys(recs).sort(function (a, b) { return (recs[b].updated || 0) - (recs[a].updated || 0); });
  for (var k = 0; k < ids.length; k++) {
    var id = ids[k], rr = recs[id];
    if (skip[id] || have[id] === rr.rev) continue;
    if (rr.purged && have[id] === undefined) continue;   // nothing to remove on a device that never had it
    if (updates.length && (bytes > MAX_BYTES || Date.now() - t0 > MAX_MS)) { more = true; break; }
    if (rr.purged) { updates.push({ id: id, rev: rr.rev, purged: true, device: rr.device || '' }); continue; }
    var d = readData_(rr);
    if (!d) { unreadable.push(id); continue; }
    bytes += rr.size || 0;
    updates.push({ id: id, rev: rr.rev, purged: false, device: rr.device || '', data: d });
  }
  return {
    ok: true, accepted: accepted, conflicts: conflicts, updates: updates, more: more, unreadable: unreadable,
    serverRev: store.rev, count: liveCount_(recs), savedAt: store.savedAt || null, savedBy: store.savedBy || '',
    lastBackupAt: store.lastBackupAt || null,
  };
}

function info_() {
  var root = root_();
  var store = readIndex_(indexFile_(root));
  return { ok: true, app: APP, v: VERSION, folderUrl: root.getUrl(), briefsUrl: sub_(root, MD).getUrl(), count: liveCount_(store.records), serverRev: store.rev,
    savedAt: store.savedAt || null, savedBy: store.savedBy || '', lastBackupAt: store.lastBackupAt || null };
}

function liveCount_(recs) {
  var n = 0;
  Object.keys(recs).forEach(function (id) { var r = recs[id]; if (!r.purged && !r.deleted) n++; });
  return n;
}

/* ---------- files ---------- */
function write_(folder, fileId, name, text, mime) {
  if (fileId) {
    try {
      var f = DriveApp.getFileById(fileId);
      if (!f.isTrashed()) { f.setContent(text); if (f.getName() !== name) f.setName(name); return fileId; }
    } catch (err) { /* gone: make a new one */ }
  }
  return folder.createFile(name, text, mime).getId();
}
function readData_(r) {
  if (!r || !r.fid) return null;
  try { return JSON.parse(DriveApp.getFileById(r.fid).getBlob().getDataAsString()); } catch (err) { return null; }
}
function trash_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { }
}

/* ---------- backups of the index ---------- */
function backup_(idxFile, root) {
  var folder = sub_(root, BACKUP);
  var stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  folder.createFile('index_' + stamp + '.json', idxFile.getBlob().getDataAsString(), 'application/json');
  var files = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/^index_.*\.json$/.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}

/* ---------- storage ---------- */
function emptyStore_() { return { app: APP, schema: 1, rev: 0, records: {} }; }
function readIndex_(file) {
  var raw = file.getBlob().getDataAsString();
  if (!raw || !raw.trim()) return emptyStore_();
  var s;
  // Never overwrite an index that can't be read: that would orphan every brief.
  try { s = JSON.parse(raw); } catch (err) { throw { code: 'corrupt_store' }; }
  if (!s || typeof s !== 'object' || (s.records && typeof s.records !== 'object')) throw { code: 'corrupt_store' };
  s.records = s.records || {};
  s.rev = s.rev || 0;
  s.app = APP; s.schema = 1;
  return s;
}
function root_() {
  var folder = DriveApp.getRootFolder();
  FOLDERS.forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}
function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function indexFile_(root) {
  var it = root.getFilesByName(INDEX);
  if (it.hasNext()) return it.next();
  return root.createFile(INDEX, JSON.stringify(emptyStore_()), 'application/json');
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
