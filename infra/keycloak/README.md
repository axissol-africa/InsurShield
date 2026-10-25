# Keycloak realm

`realm-insurshield.json` is imported on boot by the `keycloak` service in
[`docker-compose.yml`](../../docker-compose.yml) so a fresh checkout needs no
identity setup. It is a Keycloak realm export: strict JSON with no comments,
and **any key Keycloak does not recognise makes the import fail and the
container crash-loop**, so keep notes in this file rather than in the JSON.

The `insurshield-api` client's secret is the placeholder `${KEYCLOAK_CLIENT_SECRET}`, which Keycloak fills
from the container's environment at import; Compose passes it from the root `.env`. The import skips a realm
that already exists, so a Keycloak database imported earlier keeps the secret it was imported with: change it
in the admin console, or remove the database and let the realm be imported again.

## Before this leaves localhost

- `sslRequired` must be `all` once this is not on localhost.
- `insurshield-web`: set `directAccessGrantsEnabled` to `false`. It exists only
  so local scripts can fetch a token with a password; the browser uses
  Authorization Code + PKCE.
- Give `KEYCLOAK_CLIENT_SECRET` a generated value held in Secrets Manager.
- Set `KEYCLOAK_CLIENT_SECRET` for every import, not only under Compose: without it the client's secret is the
  literal text `${KEYCLOAK_CLIENT_SECRET}`. After an import, a `client_credentials` token request for
  `insurshield-api` with `client_secret=${KEYCLOAK_CLIENT_SECRET}` (quoted, so the shell does not expand it) must
  answer `401`.
- Set `redirectUris` and `webOrigins` to the deployed frontend origin; never
  leave a wildcard host.
- Configure `smtpServer` so password reset and email verification can actually
  send.
- Phone/SMS verification is parked. Keycloak has no SMS OTP; when it returns,
  either handle it in the API (`OtpChallenge`) or deploy an SMS SPI here.

See [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for how the same image runs
in production (`KC_DB=postgres` against RDS, TLS terminated in front).
