ALTER TYPE "public"."DocumentKind" ADD VALUE 'WHITE_BOOK' BEFORE 'CLAIM_ATTACHMENT';--> statement-breakpoint
DROP INDEX "inspection_shots_documentId_key";--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "whiteBookDocumentId" uuid;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_whiteBookDocumentId_fkey" FOREIGN KEY ("whiteBookDocumentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;