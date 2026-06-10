import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_user_id TEXT PRIMARY KEY,
      character_name  TEXT NOT NULL,
      realm           TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      game_version  TEXT NOT NULL,
      item_id       INTEGER,
      item_name     TEXT NOT NULL,
      raw_item_link TEXT,
      wowhead_url   TEXT
    );

    CREATE TABLE IF NOT EXISTS auctions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id_ref    INTEGER NOT NULL REFERENCES items(id),
      channel_id     TEXT NOT NULL,
      message_id     TEXT,
      status         TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'closed', 'cancelled')),
      start_price    INTEGER NOT NULL,
      min_increment  INTEGER NOT NULL,
      current_price  INTEGER NOT NULL,
      winner_user_id TEXT,
      ends_at        INTEGER NOT NULL,
      created_by     TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      closed_at      INTEGER
    );

    CREATE TABLE IF NOT EXISTS bids (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id  INTEGER NOT NULL REFERENCES auctions(id),
      user_id     TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      voided      INTEGER NOT NULL DEFAULT 0,
      void_reason TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL UNIQUE REFERENCES auctions(id),
      status     TEXT NOT NULL
                 CHECK (status IN ('unpaid', 'paid', 'traded', 'cancelled')),
      updated_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      action        TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      auction_id    INTEGER,
      payload_json  TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
    CREATE INDEX IF NOT EXISTS idx_auctions_winner ON auctions(winner_user_id);
    CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id);
    CREATE INDEX IF NOT EXISTS idx_audit_auction ON audit_log(auction_id);
  `);
}
