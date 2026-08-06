/**
 * Replaces {ts} in the template with the current timestamp.
 * @param {string} template
 * @returns {string}
 */
let seq = 0;
export function uniqueEmail(template) {
  // Date.now() alone collides for two calls in the same millisecond; the seq
  // suffix guarantees uniqueness within a process run (matters in live-submit mode).
  return template.replace('{ts}', `${Date.now()}-${seq++}`);
}
