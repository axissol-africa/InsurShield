-- Where the plate was issued. Nullable on purpose: vehicles recorded before
-- this was asked for have no answer, and guessing one would be worse than
-- leaving it blank.
ALTER TABLE "vehicles" ADD COLUMN "registrationCountry" TEXT;
