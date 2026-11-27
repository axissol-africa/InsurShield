import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluateRelease, releaseCriteria, runReleaseGate } from './release-gate.mjs';

const commit = 'e'.repeat(40);
const now = new Date('2026-11-26T12:00:00Z');
const approval = () => ({
  status: 'passed',
  approvedBy: 'Test reviewer',
  approvedAt: '2025-11-25T12:00:00Z',
  evidence: ['https://evidence.example.test/release/example'],
});
const evidence = () => ({
  schemaVersion: 1,
  environment: 'production',
  commit,
  checks: Object.fromEntries(releaseCriteria.map(([id]) =>
    [id, id === '12.11' ? { ...approval(), acceptedDefects: [] } : approval()])),
});

test('all 14 release criteria require approval against the same commit', () => {
  const complete = evidence();
  assert.equal(releaseCriteria.length, 14);
  assert.deepEqual(evaluateRelease(complete, commit, now), []);
  assert.match(evaluateRelease(complete, 'f'.repeat(40), now)[0], /different release commit/);
  assert.match(evaluateRelease(complete, 'HEAD', now)[0], /full release commit SHA/);
  complete.checks['12.12'] = { status: 'pending' };
  delete complete.checks['12.14'];
  assert.deepEqual(evaluateRelease(complete, commit, now).map((line) => line.split(' ')[0]), ['12.12', '12.14']);
});

test('the checked-in template contains every criterion and blocks release', async () => {
  const requirements = await readFile(new URL('../docs/requirements-spec.md', import.meta.url), 'utf8');
  const section = requirements.split(/^## 12\. MVP release acceptance$/m)[1]?.split(/^## 13\./m)[0];
  assert.ok(section, 'the release acceptance section exists');
  const criteria = Array.from(section.matchAll(/^(\d+)\. /gm), ([, number]) => `12.${number}`);
  const template = JSON.parse(await readFile(new URL('./release-gate.example.json', import.meta.url), 'utf8'));
  assert.deepEqual(releaseCriteria.map(([id]) => id), criteria);
  assert.deepEqual(Object.keys(template.checks), criteria);
  assert.equal(evaluateRelease({ ...template, commit }, commit, now).length, 14);
});

test('unknown schema, environment or criterion fails closed', () => {
  for (const malformed of [null, [], {}, { ...evidence(), environment: 'staging' }, { ...evidence(), schemaVersion: 2 }]) {
    assert.match(evaluateRelease(malformed, commit, now)[0], /version 1 production evidence/);
  }
  const unknown = evidence();
  unknown.checks['12.15'] = approval();
  assert.match(evaluateRelease(unknown, commit, now)[0], /unknown criterion/);
});

test('unapproved dates, placeholder reviewers and unsafe evidence are rejected', () => {
  for (const change of [
    { approvedAt: '2026-11-26T12:00:01Z' },
    { approvedAt: '2026-02-29T12:00:00Z' },
    { approvedAt: '2025-11-25T12:00:00+02:00' },
    { approvedBy: 'CHANGE_ME' },
    { evidence: [] },
    { evidence: ['http://evidence.example.test'] },
    { evidence: ['https://user:secret@evidence.example.test'] },
    { evidence: ['https://evidence.example.test/?token=secret'] },
  ]) {
    const manifest = evidence();
    Object.assign(manifest.checks['12.7'], change);
    const [blocker, ...others] = evaluateRelease(manifest, commit, now);
    assert.match(blocker, /^12\.7 .* safe evidence links/);
    assert.doesNotMatch(blocker, /token=secret|user:secret/);
    assert.deepEqual(others, []);
  }
});

test('accepted high or critical defects need documented workarounds and separate decisions', () => {
  const manifest = evidence();
  const { status, ...signOff } = approval();
  assert.equal(status, 'passed');
  const defect = { ...signOff, reference: 'BUG-123', severity: 'high', owner: 'Operations', workaround: 'Use the approved alternate workflow' };
  manifest.checks['12.11'].acceptedDefects = [defect];
  assert.deepEqual(evaluateRelease(manifest, commit, now), []);
  manifest.checks['12.11'].acceptedDefects = [defect, defect];
  assert.match(evaluateRelease(manifest, commit, now)[0], /formally|formal approval/);
  manifest.checks['12.11'].acceptedDefects = [{ ...defect, workaround: '' }];
  assert.match(evaluateRelease(manifest, commit, now)[0], /workaround/);
});

test('the release reviewer explicitly records an empty exception list', () => {
  const manifest = evidence();
  delete manifest.checks['12.11'].acceptedDefects;
  assert.deepEqual(evaluateRelease(manifest, commit, now).map((line) => line.split(' ')[0]), ['12.11']);
});

test('the command returns a failing exit code for invalid data without echoing it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'insurshield-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'candidate.json');
  const logged = [];
  const output = { log: (message) => logged.push(message), error: (message) => logged.push(message) };
  await writeFile(file, 'invalid raw evidence text');
  assert.equal(await runReleaseGate([file, commit], output), 1);
  assert.doesNotMatch(logged.join('\n'), /invalid raw evidence text/);
  await writeFile(file, JSON.stringify(evidence()));
  assert.equal(await runReleaseGate([file, commit], output), 0);
});
