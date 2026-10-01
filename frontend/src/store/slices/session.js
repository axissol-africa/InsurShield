import { DEMO_CUSTOMER_ACCOUNT } from '../demoSeed';

/**
 * Customer accounts, the staff/insurer portal session and data-protection consent.
 *
 * Prototype only: identities live in browser storage, passwords included.
 * Production authenticates against the backend and keeps no password, code or
 * consent audit record on the device.
 */

const toCustomerProfile = (account) => ({ fullName: account.fullName, email: account.email, phone: account.phone });

const matchesIdentifier = (account, identifier) =>
  account.email.toLowerCase() === identifier.toLowerCase() || account.phone === identifier;

const SIGNED_OUT = { customer: null, isAuthenticated: false, authToken: null, consentAccepted: false, consentTimestamp: null, consentRecord: null };

export const createSessionSlice = (set, get) => ({
  // ─── Customer account ────────────────────────────────────
  customer: null,
  isAuthenticated: false,
  registeredAccounts: [DEMO_CUSTOMER_ACCOUNT],

  seedDemoAccount: () =>
    set((state) =>
      state.registeredAccounts.some((account) => account.email === DEMO_CUSTOMER_ACCOUNT.email)
        ? state
        : { registeredAccounts: [DEMO_CUSTOMER_ACCOUNT, ...state.registeredAccounts] },
    ),

  registerCustomerAccount: (account) =>
    set((state) => ({
      registeredAccounts: [...state.registeredAccounts, account],
      customer: toCustomerProfile(account),
      isAuthenticated: true,
      consentAccepted: true,
      consentTimestamp: account.consentTimestamp,
    })),

  authenticateCustomer: (identifier, password) => {
    // The seeded account is always included so a stale browser session can
    // never lock an evaluator out of the prototype.
    const accounts = [DEMO_CUSTOMER_ACCOUNT, ...get().registeredAccounts.filter((account) => account.email !== DEMO_CUSTOMER_ACCOUNT.email)];
    const account = accounts.find((candidate) => matchesIdentifier(candidate, identifier) && candidate.password === password);
    if (!account) return false;
    set({
      customer: toCustomerProfile(account),
      isAuthenticated: true,
      consentAccepted: true,
      consentTimestamp: account.consentTimestamp || new Date().toISOString(),
    });
    return true;
  },

  resetCustomerPassword: (identifier, password) =>
    set((state) => ({
      registeredAccounts: state.registeredAccounts.map((account) => (matchesIdentifier(account, identifier) ? { ...account, password } : account)),
    })),

  signOut: () => set(SIGNED_OUT),

  /** Prototype only: remove the signed-in account so its details can be reused in a demo. */
  deleteCurrentAccount: () =>
    set((state) => ({
      registeredAccounts: state.registeredAccounts.filter((account) => account.email !== state.customer?.email || account.email === DEMO_CUSTOMER_ACCOUNT.email),
      ...SIGNED_OUT,
    })),

  // ─── Backend session token ───────────────────────────────
  authToken: null,
  setAuthToken: (authToken) => set({ authToken }),

  /**
   * Adopts a customer resolved elsewhere — a backend session, or an identity
   * service if one is reintroduced — with the consent held against that
   * account rather than against this browser.
   */
  applyCustomerSession: (customer, consent = null) =>
    set({
      customer: { fullName: customer.fullName, email: customer.email, phone: customer.phone ?? null },
      isAuthenticated: true,
      consentAccepted: Boolean(consent?.accepted),
      consentTimestamp: consent?.acceptedAt ?? null,
      consentRecord: consent?.accepted ? { noticeVersion: consent.noticeVersion, acceptedAt: consent.acceptedAt } : null,
    }),

  /** Clears everything tied to the person, leaving prototype catalogue data. */
  clearCustomerSession: () => set(SIGNED_OUT),

  // ─── Staff / insurer portal session ──────────────────────
  staffSession: null, // { role: 'admin' | 'support' | 'insurer', name }
  startStaffSession: (session) => set({ staffSession: session }),
  endStaffSession: () => set({ staffSession: null }),

  // ─── Data-protection consent ─────────────────────────────
  consentAccepted: false,
  consentTimestamp: null,
  consentRecord: null,
  setConsent: (accepted, record = null) =>
    set({
      consentAccepted: accepted,
      consentTimestamp: accepted ? record?.acceptedAt || new Date().toISOString() : null,
      consentRecord: accepted ? record : null,
    }),
});
