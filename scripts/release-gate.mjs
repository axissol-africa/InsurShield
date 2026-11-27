import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// The numbering is the release acceptance list in docs/requirements-spec.md.
export const releaseCriteria = [
  ['12.1', 'Functional acceptance for every Must requirement', 'Product owner and QA lead'],
  ['12.2', 'Launch insurers, products and documents', 'Product owner and insurer owners'],
  ['12.3', 'Approved and automated business rules', 'Compliance and product owner'],
  ['12.4', 'Staff MFA, permissions and tenancy', 'Security and QA leads'],
  ['12.5', 'Customer identity and recovery security', 'Security and QA leads'],
  ['12.6', 'Payment, issuance and reconciliation scenarios', 'Finance and QA leads'],
  ['12.7', 'Provider contracts, live modes and fallback tests', 'Integration owners and QA lead'],
  ['12.8', 'Document security, privacy and retention', 'Privacy and security leads'],
  ['12.9', 'Approved legal and customer-facing information', 'Legal and content owners'],
  ['12.10', 'Accessibility, performance, operations and recovery', 'QA and operations leads'],
  ['12.11', 'Critical and high defect decisions', 'Release lead and accountable risk owners'],
  ['12.12', 'Client UAT and operational go-live approvals', 'Client sponsor and operations lead'],
  ['12.13', 'Customer account and cross-device journeys', 'Product, privacy and QA leads'],
  ['12.14', 'Verified reviews, ratings and performance badges', 'Product owner, Compliance and QA lead'],
];

const commitPattern = /^[a-f0-9]{40}$/;
const timestampPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const approvalFields = ['status', 'approvedBy', 'approvedAt', 'evidence'];
const defectFields = ['reference', 'severity', 'owner', 'workaround', 'approvedBy', 'approvedAt', 'evidence'];
const knownCriteria = new Set(releaseCriteria.map(([id]) => id));

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function usesOnly(value, fields) {
  return Object.keys(value).every((field) => fields.includes(field));
}

function named(value, limit = 160) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 &&
    value.length <= limit && !/[\p{Cc}\p{Cf}]/u.test(value) && !/^(?:change_me|to be confirmed|pending|n\/a|tbd)$/i.test(value);
}

function approvalTime(value, now) {
  if (typeof value !== 'string' || !timestampPattern.test(value)) return false;
  const date = new Date(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isFinite(date.getTime()) && date.toISOString() === canonical && date <= now;
}

function evidenceReference(value) {
  if (!named(value, 2048) || !value.startsWith('https://') || /[\s\\]/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.hostname && !parsed.username && !parsed.password && !parsed.search);
  } catch {
    return false;
  }
}

function approved(value, now) {
  return named(value.approvedBy) && approvalTime(value.approvedAt, now) &&
    Array.isArray(value.evidence) && value.evidence.length > 0 &&
    value.evidence.length <= 12 && value.evidence.every(evidenceReference);
}

function defectExceptionsValid(exceptions, now) {
  return Array.isArray(exceptions) && exceptions.length <= 50 &&
    exceptions.every((item) => record(item) && usesOnly(item, defectFields) &&
      named(item.reference) && ['critical', 'high'].includes(item.severity) &&
      named(item.owner) && named(item.workaround, 500) && approved(item, now)) &&
    new Set(exceptions.map(({ reference }) => reference)).size === exceptions.length;
}

export function evaluateRelease(manifest, expectedCommit, now = new Date()) {
  if (typeof expectedCommit !== 'string' || !commitPattern.test(expectedCommit)) {
    return ['Pass the full release commit SHA from the trusted build.'];
  }
  if (!record(manifest) || !usesOnly(manifest, ['schemaVersion', 'environment', 'commit', 'checks']) ||
      manifest.schemaVersion !== 1 || manifest.environment !== 'production' || !record(manifest.checks)) {
    return ['Provide a version 1 production evidence file with a commit and checks.'];
  }

  const blockers = [];
  if (manifest.commit !== expectedCommit) blockers.push('The evidence file belongs to a different release commit.');
  if (Object.keys(manifest.checks).some((id) => !knownCriteria.has(id))) {
    blockers.push('The evidence file contains an unknown criterion.');
  }
  for (const [id, title, owner] of releaseCriteria) {
    const check = Object.hasOwn(manifest.checks, id) ? manifest.checks[id] : undefined;
    const label = `${id} ${title} (${owner})`;
    if (!record(check) || check.status !== 'passed') {
      blockers.push(`${label} needs sign-off.`);
      continue;
    }
    const fields = id === '12.11' ? [...approvalFields, 'acceptedDefects'] : approvalFields;
    if (!usesOnly(check, fields) || !approved(check, now)) {
      blockers.push(`${label} needs a named approver, approval time and safe evidence links.`);
    }
    if (id === '12.11' && !defectExceptionsValid(check.acceptedDefects, now)) {
      blockers.push(`${label} requires an explicit exception list and an owner, workaround and formal approval for each accepted defect.`);
    }
  }
  return blockers;
}

export async function runReleaseGate([file, commit, ...rest], output = console) {
  if (!file || !commit || rest.length) {
    output.error('Usage: npm run release:check -- <evidence.json> <release-commit>');
    return 1;
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    output.error('The release evidence file is missing, unreadable or invalid JSON.');
    return 1;
  }
  const blockers = evaluateRelease(manifest, commit);
  if (blockers.length) {
    output.error('Release blocked.');
    for (const blocker of blockers) output.error(`- ${blocker}`);
    return 1;
  }
  output.log(`Release evidence is complete for ${commit}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runReleaseGate(process.argv.slice(2));
}
