/**
 * Database Migration — New tables for P3-P7 upgrade
 * 
 * Run this once to add new tables to existing SQLite database.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

export function runMigrations(db) {
  // === Phase 3: Content Variation Engine ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_variations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      upload_id INTEGER,
      variation_hash TEXT NOT NULL,
      params TEXT NOT NULL,          -- JSON of variation parameters
      platform TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(video_id, variation_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_variation_video ON video_variations(video_id);
    CREATE INDEX IF NOT EXISTS idx_variation_hash ON video_variations(variation_hash);
  `);

  // === Phase 4: Trending Intelligence ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS trending_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      region TEXT NOT NULL,
      source TEXT NOT NULL,
      keywords TEXT NOT NULL,
      trending_score INTEGER,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      UNIQUE(category, region, source)
    );
    CREATE INDEX IF NOT EXISTS idx_trending_category ON trending_cache(category, region);
  `);

  // === Phase 5: Account Health ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      health_score INTEGER DEFAULT 50,
      profile_complete BOOLEAN DEFAULT 0,
      days_active INTEGER DEFAULT 0,
      total_engagements INTEGER DEFAULT 0,
      strikes INTEGER DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      shadow_ban_suspected BOOLEAN DEFAULT 0,
      last_view_velocity REAL,
      last_ctr REAL,
      cooldown_until DATETIME,
      phase TEXT DEFAULT 'warming',
      phase_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_health_check DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_health_account ON account_health(account_id);
    CREATE INDEX IF NOT EXISTS idx_health_score ON account_health(health_score);
  `);

  // === Phase 6: Multi-Account ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      type TEXT DEFAULT 'residential' CHECK(type IN ('residential', 'datacenter', 'mobile')),
      country TEXT,
      assigned_account_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'failed')),
      last_check DATETIME,
      failure_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(host, port)
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_account ON proxy_pool(assigned_account_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS warming_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      day_number INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_url TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'skipped')),
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_warming_account ON warming_log(account_id, day_number);
  `);

  // Extend accounts table with new columns (safe: SQLite ignores duplicate ALTER TABLE)
  const addColumnSafe = (table, column, type) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // Column already exists — ignore
    }
  };

  addColumnSafe('accounts', 'niche', "TEXT DEFAULT 'general'");
  addColumnSafe('accounts', 'language', "TEXT DEFAULT 'en'");
  addColumnSafe('accounts', 'timezone', "TEXT DEFAULT 'UTC'");
  addColumnSafe('accounts', 'proxy_id', 'INTEGER');
  addColumnSafe('accounts', 'warming_status', "TEXT DEFAULT 'pending'");
  addColumnSafe('accounts', 'credentials', 'TEXT');

  // Extend uploads table (for analytics)
  addColumnSafe('uploads', 'account_id', 'INTEGER');
  addColumnSafe('uploads', 'views', 'INTEGER DEFAULT 0');
  addColumnSafe('uploads', 'video_id', 'INTEGER');

  console.log('✅ Database migration complete (P3-P7 tables)');
}

export default runMigrations;
