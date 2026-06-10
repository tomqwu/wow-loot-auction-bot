import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './schema';

export type Db = Database.Database;

export function openDatabase(sqlitePath: string): Db {
  if (sqlitePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  }
  const db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
