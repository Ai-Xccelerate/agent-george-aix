/**
 * Human-readable byte size (e.g. "2.3 MB"). Used in upload-validation
 * error messages across customer docs and chat attachments.
 */
export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip path separators and replace non-safe characters so filenames can
 * be used as Supabase storage keys without encoding issues.
 */
export function sanitizeFilename(name: string): string {
  const noPath = name.replace(/^.*[\\/]/, "");
  const safe = noPath.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}
