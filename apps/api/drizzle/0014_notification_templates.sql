-- The wording the platform sends, as data rather than as code.
--
-- Version 1 of each, in use from the epoch so the first message after this
-- migration has something to render from. A later change publishes version 2
-- with its own `activeFrom`; it does not edit these rows, because a message
-- records the version it used and editing would rewrite what somebody was
-- already told.
--
-- Every one of these is mandatory: they tell a customer about money, cover or a
-- claim. Only marketing is optional, and marketing has no template yet.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'quote.ready', 'IN_APP', 'QUOTE', 1,
   'A quote is ready',
   '{{insurer}} has sent a quote for your request. Open it to compare and choose.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.ready', 'EMAIL', 'QUOTE', 1,
   'A quote is ready for your request',
   'Good news — {{insurer}} has quoted for your request. Sign in to InsurShield to compare quotes and choose your cover.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'payment.confirmed', 'IN_APP', 'PAYMENT', 1,
   'Payment received',
   'We have received your payment for {{insurer}} cover. Your policy is being prepared.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.confirmed', 'EMAIL', 'PAYMENT', 1,
   'We have received your payment',
   'Your payment for {{insurer}} cover has been received. Sign in to InsurShield to see your receipt and policy.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'policy.created', 'IN_APP', 'POLICY', 1,
   'Policy awaiting the certificate',
   'Policy {{policyNumber}} is with {{insurer}} for its certificate. We will tell you when it is issued.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'policy.certificate_issued', 'IN_APP', 'POLICY', 1,
   'Your certificate is ready',
   '{{insurer}} has issued the certificate for policy {{policyNumber}}. Your cover is active.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.certificate_issued', 'EMAIL', 'POLICY', 1,
   'Your certificate is ready',
   '{{insurer}} has issued the certificate for policy {{policyNumber}} and your cover is active. Sign in to InsurShield to download it.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'claim.received', 'IN_APP', 'CLAIM', 1,
   'Claim received',
   'We have your claim {{claimNumber}} and have sent it to {{insurer}}.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'claim.received', 'EMAIL', 'CLAIM', 1,
   'We have your claim',
   'Your claim {{claimNumber}} has been sent to {{insurer}}. Sign in to InsurShield to follow its progress.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'claim.acknowledged', 'IN_APP', 'CLAIM', 1,
   'Your insurer has your claim',
   '{{insurer}} has acknowledged claim {{claimNumber}} and will be in touch.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'claim.acknowledged', 'EMAIL', 'CLAIM', 1,
   'Your insurer has your claim',
   '{{insurer}} has acknowledged claim {{claimNumber}} and will be in touch about what happens next.', true, '1970-01-01T00:00:00Z'),

  (gen_random_uuid(), 'ncd.decided', 'IN_APP', 'NCD', 1,
   'Your no-claim discount was decided',
   '{{insurer}} has decided your no-claim discount application. Open it to see the outcome.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'ncd.decided', 'EMAIL', 'NCD', 1,
   'Your no-claim discount was decided',
   '{{insurer}} has decided your no-claim discount application. Sign in to InsurShield to see the outcome.', true, '1970-01-01T00:00:00Z');
