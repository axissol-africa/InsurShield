/** Routes are relative to the application's /api/v1 prefix. */
export const INSURER_PROFILE_ROUTES = {
  public: 'insurer-profiles/:insurerId',
  ownRevisions: 'insurer/profile/revisions',
  adminRevisions: 'admin/insurer-profiles/:insurerId/revisions',
  decision: 'admin/insurer-profiles/:insurerId/revisions/:revisionId/decision',
} as const;

/** Public fields are approved together; licence and product fields cannot be submitted. */
export interface ProfileContent {
  brandName: string;
  description: string;
  serviceInformation: string;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
}

export interface PublicInsurerProfile {
  insurerId: string;
  name: string;
  tradingName: string | null;
  status: string;
  licence: { number: string | null; expiresAt: string | null; current: boolean };
  revisionId: string;
  profile: ProfileContent;
  products: { productId: string; versionId: string; name: string; coverType: string }[];
  productsTruncated: boolean;
}
