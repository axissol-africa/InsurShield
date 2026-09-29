# Keycloak realm

`realm-insurshield.json` is imported on boot by the `keycloak` service in
[`docker-compose.yml`](../../docker-compose.yml) so a fresh checkout needs no
identity setup. It is a Keycloak realm export: strict JSON with no comments,
and **any key Keycloak does not recognise makes the import fail and the
container crash-loop**, so keep notes in this file rather than in the JSON.

## Before this leaves localhost

- `sslRequired` must be `all` once this is not on localhost.
- `insurshield-web`: set `directAccessGrantsEnabled` to `false`. It exists only
  so local scripts can fetch a token with a password; the browser uses
  Authorization Code + PKCE.
- Replace the `insurshield-api` secret with a generated value held in Secrets
  Manager.
- Set `redirectUris` and `webOrigins` to the deployed frontend origin; never
  leave a wildcard host.
- Configure `smtpServer` so password reset and email verification can actually
  send.
- Phone/SMS verification is parked. Keycloak has no SMS OTP; when it returns,
  either handle it in the API (`OtpChallenge`) or deploy an SMS SPI here.

See [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for how the same image runs
in production (`KC_DB=postgres` against RDS, TLS terminated in front).
