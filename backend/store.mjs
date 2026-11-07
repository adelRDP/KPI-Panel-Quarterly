import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export function openStore(root,{readOnly=false}={}) {
  if(!readOnly)mkdirSync(root,{recursive:true});
  const db = new DatabaseSync(join(root,'panel.sqlite'),{readOnly});
  if(!readOnly)db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent TEXT, value TEXT NOT NULL);');
  if(!readOnly)db.exec("CREATE INDEX IF NOT EXISTS records_kind_parent ON records(kind,parent); CREATE INDEX IF NOT EXISTS records_queued_reviews ON records(json_extract(value,'$.inputsVersion'),json_extract(value,'$.policyVersion')) WHERE kind='review' AND json_extract(value,'$.status')='queued';");
  // Synchronous read scopes share parsed records only for one request. No data
  // survives the scope; mutations and rollbacks invalidate any active scope.
  let readCache=null;
  const key=(...parts)=>JSON.stringify(parts),invalidate=()=>readCache?.clear();
  return {
    pendingAdminRequestCount() {
      // Count actionable records directly; never parse historical request bodies
      // or confuse unread notifications with work awaiting an admin decision.
      return db.prepare("SELECT count(*) AS n FROM records WHERE (kind='position-assignment' AND json_extract(value,'$.status')='hr_approval') OR (kind IN ('kpi-design','quarter-evaluation','quarter-appeal') AND json_extract(value,'$.status')='hr_review' AND (kind<>'kpi-design' OR coalesce(json_extract(value,'$.removedAt'),'') IN ('',0)))").get().n;
    },
    recent(kind,limit=100) { if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Invalid record limit');return db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?').all(kind,limit).map(row=>JSON.parse(row.value)); },
    nextQueuedReview(inputsVersion,policyVersion) { const row=db.prepare("SELECT value FROM records WHERE kind='review' AND json_extract(value,'$.status')='queued' AND json_extract(value,'$.inputsVersion')=? AND json_extract(value,'$.policyVersion')=? ORDER BY rowid ASC LIMIT 1").get(inputsVersion,policyVersion);return row?JSON.parse(row.value):null; },
    withReadCache(fn) { const previous=readCache;readCache=previous||new Map();try{return fn();}finally{readCache=previous;} },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } finally {invalidate();} },
    put(kind,value,parent=null) { const record={...value,id:value.id||randomUUID()}; db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?)').run(record.id,kind,parent,JSON.stringify(record)); invalidate();return record; },
    get(id,kind,parent) { const cacheKey=parent===undefined?key('get',kind,id):key('child',kind,id,parent);if(readCache?.has(cacheKey))return readCache.get(cacheKey);const row=parent===undefined?db.prepare('SELECT value FROM records WHERE id=? AND kind=?').get(id,kind):db.prepare('SELECT value FROM records WHERE id=? AND kind=? AND parent=?').get(id,kind,parent),value=row?JSON.parse(row.value):null;readCache?.set(cacheKey,value);return value; },
    remove(id,kind,parent) { const result=db.prepare('DELETE FROM records WHERE id=? AND kind=? AND parent IS ?').run(id,kind,parent);invalidate();return result; },
    list(kind,parent) { const cacheKey=parent===undefined?key('list',kind):key('list',kind,parent);if(readCache?.has(cacheKey))return readCache.get(cacheKey).slice();const rows=parent===undefined?db.prepare('SELECT parent,value FROM records WHERE kind=? ORDER BY rowid DESC').all(kind):db.prepare('SELECT parent,value FROM records WHERE kind=? AND parent=? ORDER BY rowid DESC').all(kind,parent),values=rows.map(r=>{const value=JSON.parse(r.value);readCache?.set(key('get',kind,value.id),value);readCache?.set(key('child',kind,value.id,r.parent),value);return value;});readCache?.set(cacheKey,values);return values.slice(); },
    close() { db.close(); }
  };
}
