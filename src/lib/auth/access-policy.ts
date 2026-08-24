/**
 * DELETED 2026-08-21 — this module is gone, and this note is a signpost.
 *
 * It held a hardcoded ALLOWED_DOMAINS pair, an isAllowedEmail gate, and an
 * AIX_ORG_ID constant. Under AIX Core auth none of it decided anything: Core
 * owns identity, membership and per-agent entitlement, and George stopped
 * admitting users itself when Supabase auth was retired. The only remaining
 * consumer was display copy on the users screen, telling admins that invites
 * were limited to two specific companies' domains — one of which belonged to a
 * different tenant entirely.
 *
 * Who counts as internal is now resolved per organisation from its own row.
 * See lib/agent/identity.ts.
 */
export {};
