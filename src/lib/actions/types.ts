/**
 * Shared result type for server actions that surface inline success/error
 * feedback (settings forms, admin operations, etc.).
 */
export type ActionResult = { error?: string; info?: string };
