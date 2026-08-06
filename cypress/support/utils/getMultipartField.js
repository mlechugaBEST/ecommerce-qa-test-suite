export function getMultipartField(body, fieldName) {
  // Escape regex metacharacters — fieldName is a Zoho field name interpolated into the pattern.
  // Current names are all [A-Za-z0-9_], so this is a no-op today, but a future field with a
  // metachar (e.g. a dot or bracket) would otherwise be silently mis-parsed rather than matched.
  const safe = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`name="${safe}"\\r\\n\\r\\n([^\\r]*)`, '');
  const match = body.match(re);
  return match ? match[1] : null;
}
