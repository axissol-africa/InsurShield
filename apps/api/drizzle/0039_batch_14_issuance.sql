-- What the customer is told while the insurer issues a paid policy.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'policy.issuance_accepted', 'IN_APP', 'POLICY', 1,
   'Your policy is being issued',
   '{{insurer}} has accepted policy {{policyNumber}} and is preparing your certificate.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.issuance_delayed', 'IN_APP', 'POLICY', 1,
   'Your certificate is taking longer',
   '{{insurer}} has not issued policy {{policyNumber}} yet. We are following it up and will tell you as soon as it is ready.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.issuance_delayed', 'EMAIL', 'POLICY', 1,
   'Your certificate is taking longer than expected',
   '{{insurer}} has not issued policy {{policyNumber}} yet. We are following it up with them and will tell you as soon as your certificate is ready.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.issuance_failed', 'IN_APP', 'POLICY', 1,
   'Your policy could not be issued',
   '{{insurer}} could not issue policy {{policyNumber}}: {{reason}} Your payment will be refunded and our team will contact you.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.issuance_failed', 'EMAIL', 'POLICY', 1,
   'Your policy could not be issued',
   '{{insurer}} could not issue policy {{policyNumber}}. Their reason: {{reason}} Your payment will be refunded and our team will contact you. Sign in to InsurShield to follow the refund.', true, '1970-01-01T00:00:00Z');
