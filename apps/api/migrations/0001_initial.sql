PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, email_verified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auth_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
 expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_tokens_user_purpose ON auth_tokens(user_id,purpose);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('personal','business')),
 currency TEXT NOT NULL DEFAULT 'USD', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE workspace_members (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE transactions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 created_by TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
 amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), currency TEXT NOT NULL,
 description TEXT NOT NULL, occurred_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_transactions_workspace_date ON transactions(workspace_id,occurred_on);
CREATE TABLE budgets (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), currency TEXT NOT NULL,
 period TEXT NOT NULL CHECK (period IN ('monthly','weekly','yearly')),
 starts_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
