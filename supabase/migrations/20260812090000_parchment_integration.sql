-- Parchment as a connectable integration.
--
-- An org connects its own Parchment knowledge hub from Settings → Knowledge, so
-- the connection is per-org data rather than a process-wide environment
-- variable: two orgs on the same deployment must be able to point at two
-- different workspaces, and neither should need a redeploy to connect.
--
-- The existing `integrations` table already models exactly this (org_id +
-- provider + status + metadata), so this only teaches the provider enum a new
-- value. ALTER TYPE ... ADD VALUE is safe on PG 12+ outside a transaction that
-- also uses the value; it is additive and non-breaking for existing rows.
--
-- Credential storage note: the table's `vault_secret_id` column assumed Supabase
-- Vault, which no longer exists now the database is plain Railway Postgres. The
-- API key is therefore encrypted by the application (AES-256-GCM, key from
-- APP_ENCRYPTION_KEY) and stored in `metadata.key_ciphertext`. Plaintext was not
-- an option: a Parchment key grants read — and with an editor role, write —
-- access to the org's whole knowledge base.

alter type integration_provider add value if not exists 'parchment';
