import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrationStatements } from './migration-helpers.mjs';

const db=new DatabaseSync(':memory:');
try {
 for(const name of ['0001_initial.sql','0002_account_login.sql','0003_account_permissions.sql','0004_inspection_photos.sql','0005_calendar.sql'])
  for(const sql of migrationStatements(readFileSync('migrations/'+name,'utf8')))db.exec(sql);
 db.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at,must_change_password,temporary_expires_at) VALUES(?,?,?,?,?,?,?,?)')
  .run('legacy','legacy-user','encrypted-name-bytes','password-hash-bytes','admin','2026-11-01',1,9999999999999);
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-hash','legacy',9999999999999);
 db.prepare('INSERT INTO inspections VALUES(?,?,?,?,?,?,?)').run('record','legacy','encrypted-inspection',3,0,'operation','2026-11-01');
 db.prepare('INSERT INTO inspection_photos VALUES(?,?,?,?,?,?)').run('legacy','record','photo','encrypted-photo',123,null);
 const before={accounts:db.prepare('SELECT * FROM accounts').all(),sessions:db.prepare('SELECT * FROM sessions').all(),records:db.prepare('SELECT * FROM inspections').all(),photos:db.prepare('SELECT * FROM inspection_photos').all()};
 const migration=readFileSync('migrations/0006_account_storage.sql','utf8');
 for(const sql of migrationStatements(migration))db.exec(sql);
 assert.deepEqual(db.prepare('SELECT * FROM accounts').all(),before.accounts);
 assert.deepEqual(db.prepare('SELECT * FROM sessions').all(),before.sessions);
 assert.deepEqual(db.prepare('SELECT * FROM inspections').all(),before.records);
 assert.deepEqual(db.prepare('SELECT * FROM inspection_photos').all(),before.photos);
 assert.equal(db.prepare('SELECT display_name FROM account_profiles WHERE account_id=?').get('legacy').display_name,'encrypted-name-bytes');
 const credentials=db.prepare('SELECT * FROM account_credentials WHERE account_id=?').get('legacy');
 assert.equal(credentials.password_hash,'password-hash-bytes');assert.equal(credentials.must_change_password,1);assert.equal(credentials.temporary_expires_at,9999999999999);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log('PASS: pre-existing ciphertext, password hashes, sessions, inspection IDs/revisions and photos survive account separation byte-for-byte');
 db.exec('PRAGMA recursive_triggers=ON');
 db.prepare('UPDATE accounts SET display_name=? WHERE id=?').run('old-worker-name','legacy');
 assert.equal(db.prepare('SELECT display_name,revision FROM account_profiles').get().display_name,'old-worker-name');
 const revision=db.prepare('SELECT revision FROM account_profiles').get().revision;
 db.prepare('UPDATE account_profiles SET display_name=? WHERE account_id=?').run('new-worker-name','legacy');
 assert.equal(db.prepare('SELECT display_name FROM accounts').get().display_name,'new-worker-name');
 assert.equal(db.prepare('SELECT revision FROM account_profiles').get().revision,revision+1);
 db.prepare('UPDATE accounts SET password_hash=?,must_change_password=0,temporary_expires_at=NULL WHERE id=?').run('old-worker-password','legacy');
 assert.equal(db.prepare('SELECT password_hash FROM account_credentials').get().password_hash,'old-worker-password');
 db.prepare('UPDATE account_credentials SET password_hash=?,must_change_password=1,temporary_expires_at=? WHERE account_id=?').run('new-worker-password',555,'legacy');
 assert.equal(db.prepare('SELECT password_hash FROM accounts').get().password_hash,'new-worker-password');
 db.prepare('INSERT INTO accounts(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run('second','second-user','encrypted-second','second-hash','inspector','2026-11-13');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_profiles').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_credentials').get().n,2);
 assert.throws(()=>db.prepare('INSERT INTO account_profiles VALUES(?,?,?)').run('orphan','name',1));
 assert.throws(()=>db.prepare('UPDATE account_credentials SET must_change_password=2').run());
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log('PASS: old/new Worker writes remain compatible even with recursive triggers; orphan profiles and invalid credential states are rejected');
}finally{db.close();}
