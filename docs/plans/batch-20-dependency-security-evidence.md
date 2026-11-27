# Batch 20 dependency security evidence

Checked 2026-11-27 with Node 24.15.0 and npm 11.20.0. The checks cover the local lockfile and installed packages.

## Scope and result

The supplied audit and a fresh `npm audit --omit=dev --json` each reported 16 entries (8 high, 8 moderate). Eight entries belong to ordinary dependency paths; eight are on `devOptional` tooling paths. This slice removes all eight ordinary-path entries. The follow-up jsdom-scoped Undici patch also removes the remaining high finding. The final installed audit reports **7 moderate entries, 0 high and 0 critical**. `npm audit --omit=dev --audit-level=high --json` exits 0. The default all-severity audit still exits 1; moderate findings are not waived.

| Package | Previous lock | Patched lock | Advisory |
| --- | --- | --- | --- |
| `@nestjs/platform-express` | 12.2.0 | 12.2.0 (Multer override) | Multer dependency finding |
| `multer` | 2.4.0 | 2.5.0 | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) |
| `body-parser` | 2.3.0 | 2.4.0 | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `follow-redirects` | 1.16.0 | 1.16.2 | [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) |
| `qs` | 6.16.0 | 6.16.1 | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| `source-map-js` | 1.2.1 | 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `zod` | 4.6.5 | 4.6.6 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| `vite` | 8.3.0 | 8.3.3 | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) |

Exact patched releases, dependency requirements, engines and tarball integrity were checked with `npm view <package>@<version> ... --json --prefer-online` against the upstream npm registry. Advisory affected ranges were checked against the current audit and linked upstream advisories. Nest 12.2.1 is not published; upgrading the Nest framework is unnecessary for this slice.

The additional `jsdom@30.1.1` override pins its Undici dependency from 8.11.0 to 8.12.2, covering the current [Undici advisory](https://github.com/advisories/GHSA-4qv8-2p9j-2685) and the other eight advisories reported on that path. Exact-version registry metadata and integrity were verified. Other Undici major versions and their existing locked patches remain unchanged.

## Resolution decisions

- API Zod and web Vite are pinned to the minimum verified patched releases above. No direct runtime dependency was added.
- Root overrides target affected version ranges for body-parser, follow-redirects, qs and source-map-js. The Multer override applies only beneath `@nestjs/platform-express@12.2.0`, which otherwise pins vulnerable Multer 2.4.0. All changes stay on existing major versions.
- Vite 8.3.3 requires Rolldown `~1.2.11`; the lock uses 1.2.11 with matching platform bindings. This avoids the unrelated compiler/type and optional WASM runtime upgrades selected by the latest compatible 1.2.19. No permanent Rolldown override is needed. npm relocates some existing optional dependency entries; their versions are unchanged.
- Remove or reassess overrides when upgrading the affected parents. Do not remove them without a fresh graph check and audit.

## Residual findings

These are still reported by `--omit=dev` because their lock entries are `devOptional`. That flag is not proof that tooling is absent from a deployed installation.

| Path | Remaining entries | Follow-up |
| --- | --- | --- |
| drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild | 4 moderate | Existing esbuild 0.18.20 path. npm proposes a breaking drizzle-kit downgrade; rejected. A separate tooling compatibility change is needed. |
| Vitest / coverage / mocker | 3 moderate | Existing 5.0.1; registry confirms 5.0.3 is available. Coordinate a separate test-toolchain update with ongoing verification. |

## Verification and coordination

Passed:

- `npm install --package-lock-only --ignore-scripts --no-audit`, followed by targeted `npm update ... --package-lock-only` to resolve the overrides. A subsequent offline lock-only resolution succeeded.
- `npm ls --package-lock-only multer body-parser follow-redirects qs source-map-js zod vite rolldown --all` exits 0.
- Assertions confirm all eight targeted package names are absent from the final advisory report.
- Patched package integrity values match the exact-version upstream metadata.
- `git diff --check` for the changed manifests, lock and this document.

Full `npm ls --package-lock-only --all` reports one pre-existing peer mismatch: `vite-tsconfig-paths/node_modules/tsconfck` requires TypeScript `^5.0.0`, while the original and final lock both contain TypeScript 6.0.3. No TypeScript or tsconfck version changed.

`npm ci --no-audit` installed 1,188 packages and reported the existing install-script approval warnings.

Installed verification passed:

- `npm ls multer body-parser follow-redirects qs source-map-js zod vite rolldown undici --all` exits 0; direct package-file assertions match all eight patched package versions.
- `npm audit --omit=dev --audit-level=high --json` exits 0: 0 high, 0 critical, 7 moderate.
- Focused API regression: 8 files, 174 tests passed (environment validation, error filter, observability, mail sender and endpoint safety). The first sandboxed run could not bind loopback test servers; rerunning with local socket permission passed without code changes.
- Focused web regression: 3 files, 20 tests passed (guards, environment configuration and support page), exercising the patched Vite/jsdom dependency graph.

Main owns full API integration, performance verification and final lint/typecheck/build gates. Those wider checks are not claimed by this slice. No further source or dependency changes are planned during integration.

Local audit artifacts for this session:

- Before: `/tmp/insurshield-b20-prod-audit-before.json`
- Lock-only initial remediation: `/tmp/insurshield-b20-prod-audit-after.json`
- Final installed audit: `/tmp/insurshield-b20-prod-audit-installed.json`
- Installed graph: `/tmp/b20-security-installed-graph.txt`
- API regression: `/tmp/b20-security-api-installed-tests.txt`
- Targeted graph: `/tmp/b20-security-lock-graph.txt`
- Full graph: `/tmp/b20-security-full-lock-graph.txt`

These temporary artifacts are not committed; rerun the commands for later release evidence because advisories can change.
