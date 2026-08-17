/**
 * Warn when the tests are being driven by a Node version they aren't pinned to.
 *
 * The .bat launchers can't be bypassed by accident — they all `call`
 * scripts/ensure-node.bat, which puts an accepted Node on PATH. But running
 * `npm run test:all` straight from a terminal skips that entirely and inherits
 * whatever Node happens to be on PATH, with no signal at all that it happened.
 *
 * The tell that this had been going unnoticed was a `DEP0205
 * DeprecationWarning: module.register()` line in a run's output: that warning
 * only exists on Node >= 26, so its presence proved the run was on a version
 * the bootstrap deliberately rejects.
 *
 * This is a WARNING, never a failure: `cypress run` works fine on Node 26 —
 * it's `cypress install` that breaks (silently, exiting 0 while leaving no
 * browser behind). So blocking a run that would have succeeded would be worse
 * than the problem. We just make the situation visible.
 *
 * The accepted set below is a deliberate MIRROR of `:__en_gate` in
 * scripts/ensure-node.bat, which is the source of truth and carries the
 * evidence for each accept/reject. Change both together, and see
 * MAINTENANCE.md for the verification procedure.
 */

// Majors 24 and 22. Not 20 (EOL April 30 2026), not 26 (Cypress 15.15.0's
// unzip stack dies on it — see :__en_gate).
const ACCEPTED_MAJORS = [24, 22];

function isAcceptedNodeVersion(version) {
  const [major, minor] = String(version).split('.');
  // Reject anything that isn't a plain integer major.minor, matching the
  // batch gate's input validation rather than trusting a weird version string.
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor || '')) return false;
  return ACCEPTED_MAJORS.includes(Number(major));
}

/**
 * Print a warning to stderr if the running Node isn't one we've verified.
 * Always returns the answer rather than exiting, so callers stay in control.
 */
function warnIfUnsupportedNode(version = process.versions.node) {
  if (isAcceptedNodeVersion(version)) return true;

  // Built rather than hand-drawn so the borders can't drift out of
  // alignment when the wording is edited.
  const title = 'Node.js version not verified for this test suite';
  const pad = '─'.repeat(title.length + 4);
  const lines = [
    '',
    `  ┌${pad}┐`,
    `  │  ${title}  │`,
    `  └${pad}┘`,
    `  Running on Node v${version}. These tests are verified on Node 24 and 22.`,
    '',
    '  The run will continue — `cypress run` is usually fine. The real',
    '  casualty is `cypress install`, which on Node 26 exits 0 while leaving',
    '  no browser behind (a DEP0205 module.register() warning in the output',
    '  means you are on Node 26 or newer).',
    '',
    '  To run on the pinned version instead, use one of the launchers',
    '  ("Run All Tests.bat" / "Run One Store.bat"), which put the right Node',
    '  on PATH for you — or call it directly:',
    '      tools\\node-v24.19.0-win-x64\\node.exe scripts\\run-all.js',
    '',
  ];
  console.error(lines.join('\n'));
  return false;
}

module.exports = { warnIfUnsupportedNode, isAcceptedNodeVersion, ACCEPTED_MAJORS };
