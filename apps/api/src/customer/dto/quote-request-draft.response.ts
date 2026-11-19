export interface QuoteRequestDraftResponse {
  id: string;
  commonAnswers: Record<string, unknown>;
  selectedProductVersionIds: string[];
  configurableAnswers: Record<string, unknown>;
  documentReferences: Array<{
    slot: string;
    kind: 'WHITE_BOOK' | 'INSPECTION_PHOTO';
    documentId: string;
  }>;
  unavailableProducts: Array<{
    productVersionId: string;
    code: 'PRODUCT_VERSION_UNAVAILABLE' | 'PRODUCT_DURATION_UNAVAILABLE' | 'PRODUCT_CONFIGURATION_AMBIGUOUS';
    message: string;
  }>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
