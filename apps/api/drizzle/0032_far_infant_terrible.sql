-- The requirement response tables already reference this key. Adopt the
-- existing unique index as a constraint instead of dropping it, so those
-- foreign keys remain valid during an upgrade from migration 0031.
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_request_version_key" UNIQUE USING INDEX "quote_request_product_versions_request_version_key";
