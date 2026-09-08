import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { INSURER_RATES, PIA_CONFIG } from '../utils/insurerRates';

// Prototype-only identities. A production implementation must authenticate
// against a secure service and never keep passwords in browser storage.
export const DEMO_CUSTOMER_ACCOUNT = {
  id: 'CUS-DEMO-001', fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm',
  phone: '0970123456', password: 'Customer123!', consentTimestamp: '2026-09-01T09:00:00.000Z',
};

export const useStore = create(
  persist(
    (set, get) => ({
      // ─── User ───────────────────────────────────────────────
      userPhone: '',
      customer: null,
      isAuthenticated: false,
      registeredAccounts: [DEMO_CUSTOMER_ACCOUNT],
      seedDemoAccount: () => set((state) => state.registeredAccounts.some(account => account.email === DEMO_CUSTOMER_ACCOUNT.email)
        ? state
        : { registeredAccounts: [DEMO_CUSTOMER_ACCOUNT, ...state.registeredAccounts] }),
      setUserPhone: (phone) => set({ userPhone: phone }),
      registerCustomerAccount: (account) => set((state) => ({
        registeredAccounts: [...state.registeredAccounts, account],
        customer: { fullName: account.fullName, email: account.email, phone: account.phone },
        userPhone: account.phone,
        isAuthenticated: true,
      })),
      authenticateCustomer: (identifier, password) => {
        // Always include the seeded account so a previous browser session with
        // locally saved prototype accounts cannot lock the evaluator out.
        const accounts = [DEMO_CUSTOMER_ACCOUNT, ...get().registeredAccounts.filter(account => account.email !== DEMO_CUSTOMER_ACCOUNT.email)];
        const account = accounts.find(candidate =>
          (candidate.email.toLowerCase() === identifier.toLowerCase() || candidate.phone === identifier) && candidate.password === password
        );
        if (!account) return false;
        set({ customer: { fullName: account.fullName, email: account.email, phone: account.phone }, userPhone: account.phone, isAuthenticated: true, consentAccepted: true, consentTimestamp: account.consentTimestamp || new Date().toISOString() });
        return true;
      },
      resetCustomerPassword: (identifier, password) => set((state) => ({
        registeredAccounts: state.registeredAccounts.map(account =>
          account.email.toLowerCase() === identifier.toLowerCase() || account.phone === identifier ? { ...account, password } : account
        ),
      })),
      signOut: () => set({ customer: null, userPhone: '', isAuthenticated: false, consentAccepted: false, consentTimestamp: null, consentRecord: null }),

      // ─── POPIA Consent ───────────────────────────────────────
      consentAccepted: false,
      consentTimestamp: null,
      consentRecord: null,
      setConsent: (accepted, record = null) => set({
        consentAccepted: accepted,
        consentTimestamp: accepted ? (record?.acceptedAt || new Date().toISOString()) : null,
        consentRecord: accepted ? record : null,
      }),

      // ─── Quote Rules Agreement ───────────────────────────────
      quoteRulesAgreed: false,
      quoteRulesTimestamp: null,
      setQuoteRulesAgreed: (agreed) => set({
        quoteRulesAgreed: agreed,
        quoteRulesTimestamp: agreed ? new Date().toISOString() : null,
      }),

      // ─── Vehicle Details ─────────────────────────────────────
      vehicleDetails: null,
      setVehicleDetails: (details) => set({ vehicleDetails: details }),

      vehicleValue: 0,
      setVehicleValue: (val) => set({ vehicleValue: val }),

      // ─── Vehicle Usage ───────────────────────────────────────
      vehicleUsage: '',
      setVehicleUsage: (usage) => set({ vehicleUsage: usage }),

      // ─── Insurance Type ──────────────────────────────────────
      insuranceType: '',
      setInsuranceType: (type) => set({ insuranceType: type }),

      // ─── Policy Duration & Dates ─────────────────────────────
      coverageDurationId: '4q',
      policyStartDate: new Date().toISOString().split('T')[0],
      policyDates: null,
      setCoverageDuration: (durationId) => set({ coverageDurationId: durationId }),
      setPolicyStartDate: (date) => set({ policyStartDate: date }),
      setPolicyDates: (dates) => set({ policyDates: dates }),

      // ─── NCD Code (pre-approved from insurer) ─────────────────
      ncdCode: '',
      ncdCodeValidated: null, // { percentage, insurer, yearsClaimFree } or null
      ncdCodeUsed: false,     // true once applied to a confirmed policy
      setNcdCode: (code) => set({ ncdCode: code }),
      setNcdCodeValidated: (result) => set({ ncdCodeValidated: result }),
      clearNcdCode: () => set({ ncdCode: '', ncdCodeValidated: null, ncdCodeUsed: false }),
      markNcdCodeUsed: () => set({ ncdCodeUsed: true }),

      // ─── NCD Applications (submitted to insurers) ─────────────
      ncdApplications: [],
      addNcdApplication: (app) => set((state) => ({
        ncdApplications: [
          {
            ...app,
            id: `NCDA-${Date.now()}`,
            applicationNumber: `NCD-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            status: 'Submitted',
            submittedAt: new Date().toISOString(),
            approvedCode: null,
          },
          ...state.ncdApplications,
        ],
      })),
      updateNcdApplicationStatus: (appId, status, approvedCode) => set((state) => ({
        ncdApplications: state.ncdApplications.map(a =>
          a.id === appId
            ? { ...a, status, approvedCode: approvedCode || a.approvedCode, updatedAt: new Date().toISOString() }
            : a
        ),
      })),

      // ─── PIA Configuration ────────────────────────────────────
      piaConfig: { ...PIA_CONFIG },
      setPiaConfig: (config) => set({ piaConfig: { ...get().piaConfig, ...config } }),

      // ─── Insurers List ────────────────────────────────────────
      insurersList: INSURER_RATES,
      addInsurer: (insurer) => set((state) => ({
        insurersList: [...state.insurersList, { ...insurer, id: Date.now().toString() }],
      })),
      updateInsurerRate: (insurerId, updates) => set((state) => ({
        insurersList: state.insurersList.map(i => i.id === insurerId ? { ...i, ...updates } : i),
      })),

      // ─── Selected Insurers ────────────────────────────────────
      selectedInsurers: [],
      setMockInsurers: (insurers) => set({ selectedInsurers: insurers }),
      toggleInsurer: (insurer) => set((state) => {
        const isSelected = state.selectedInsurers.some(i => i.id === insurer.id);
        if (isSelected) return { selectedInsurers: state.selectedInsurers.filter(i => i.id !== insurer.id) };
        if (state.selectedInsurers.length < 5) return { selectedInsurers: [...state.selectedInsurers, insurer] };
        return state;
      }),
      clearInsurers: () => set({ selectedInsurers: [] }),

      // ─── Quote Status ─────────────────────────────────────────
      quoteStatus: 'idle',
      setQuoteStatus: (status) => set({ quoteStatus: status }),

      selectedQuote: null,
      setSelectedQuote: (quote) => set({ selectedQuote: quote }),

      premiumBreakdown: null,
      setPremiumBreakdown: (breakdown) => set({ premiumBreakdown: breakdown }),

      // ─── Cross-portal prototype records ──────────────────────
      quoteRequests: [],
      addQuoteRequest: (request) => set((state) => ({
        quoteRequests: [{
          ...request, id: `QR-${Date.now()}`, status: 'Submitted', submittedAt: new Date().toISOString(),
        }, ...state.quoteRequests],
      })),
      addInsurerQuote: (requestId, insurer, quote) => set((state) => ({
        quoteRequests: state.quoteRequests.map(request => request.id === requestId
          ? { ...request, status: 'Quoted', insurerQuotes: { ...(request.insurerQuotes || {}), [insurer]: { ...quote, sentAt: new Date().toISOString() } } }
          : request),
      })),
      policies: [],
      addPolicy: (policy) => set((state) => state.policies.some(item => item.policyNumber === policy.policyNumber)
        ? state
        : { policies: [{ ...policy, issuedAt: new Date().toISOString(), status: 'Active' }, ...state.policies] }),

      // ─── Documents ───────────────────────────────────────────
      documents: {
        whiteBook: null,
        insp_front: null, insp_back: null, insp_left: null, insp_right: null, insp_mileage: null,
      },
      setDocument: (type, url) => set((state) => ({
        documents: { ...state.documents, [type]: url },
      })),

      // ─── Claims ───────────────────────────────────────────────
      claims: [],
      addClaim: (claim) => set((state) => ({
        claims: [{ ...claim, id: `CLM-${Date.now()}`, submittedAt: new Date().toISOString() }, ...state.claims],
      })),
      updateClaimStatus: (claimId, status, note) => set((state) => ({
        claims: state.claims.map(c =>
          c.id === claimId
            ? { ...c, status, timeline: [...(c.timeline || []), { status, note, date: new Date().toISOString() }] }
            : c
        ),
      })),
      addClaimMessage: (claimId, message) => set((state) => ({
        claims: state.claims.map(c =>
          c.id === claimId
            ? { ...c, messages: [...(c.messages || []), { ...message, id: Date.now(), sentAt: new Date().toISOString() }] }
            : c
        ),
      })),
      updateClaimStatusWithMsg: (claimId, status, note, message) => set((state) => ({
        claims: state.claims.map(c =>
          c.id === claimId
            ? {
                ...c,
                status,
                timeline: [...(c.timeline || []), { status, note, date: new Date().toISOString() }],
                messages: message
                  ? [...(c.messages || []), { id: Date.now(), senderType: 'insurer', message, sentAt: new Date().toISOString() }]
                  : c.messages,
              }
            : c
        ),
      })),

      // ─── Support Tickets ──────────────────────────────────────
      supportTickets: [],
      addTicket: (ticket) => set((state) => ({
        supportTickets: [{ ...ticket, id: `TKT-${Date.now()}`, createdAt: new Date().toISOString(), status: 'Open', messages: [], internalNotes: [], escalations: [], assignedTo: null }, ...state.supportTickets],
      })),
      updateTicketStatus: (ticketId, status) => set((state) => ({
        supportTickets: state.supportTickets.map(t =>
          t.id === ticketId ? { ...t, status, updatedAt: new Date().toISOString() } : t
        ),
      })),
      addTicketMessage: (ticketId, message) => set((state) => ({
        supportTickets: state.supportTickets.map(t =>
          t.id === ticketId
            ? { ...t, messages: [...(t.messages || []), { ...message, id: Date.now(), sentAt: new Date().toISOString() }] }
            : t
        ),
      })),
      assignTicket: (ticketId, agentName) => set((state) => ({
        supportTickets: state.supportTickets.map(t =>
          t.id === ticketId ? { ...t, assignedTo: agentName, updatedAt: new Date().toISOString() } : t
        ),
      })),
      addTicketInternalNote: (ticketId, note) => set((state) => ({
        supportTickets: state.supportTickets.map(t =>
          t.id === ticketId
            ? { ...t, internalNotes: [...(t.internalNotes || []), { ...note, id: Date.now(), createdAt: new Date().toISOString() }] }
            : t
        ),
      })),
      addTicketEscalation: (ticketId, escalation) => set((state) => ({
        supportTickets: state.supportTickets.map(t =>
          t.id === ticketId
            ? {
                ...t,
                status: 'Waiting for Insurer',
                escalations: [...(t.escalations || []), { ...escalation, id: Date.now(), createdAt: new Date().toISOString() }],
                updatedAt: new Date().toISOString(),
              }
            : t
        ),
      })),

      // ─── Chat ─────────────────────────────────────────────────
      chatMessages: [],
      chatOpen: false,
      unreadCount: 0,
      addChatMessage: (message) => set((state) => ({
        chatMessages: [...state.chatMessages, { ...message, id: Date.now(), sentAt: new Date().toISOString() }],
        unreadCount: message.senderType === 'support' ? state.unreadCount + 1 : state.unreadCount,
      })),
      setChatOpen: (open) => set({ chatOpen: open, unreadCount: open ? 0 : get().unreadCount }),
      clearUnread: () => set({ unreadCount: 0 }),

      // ─── Inspections ──────────────────────────────────────────
      inspections: [],
      addInspection: (inspection) => set((state) => ({
        inspections: [{ ...inspection, id: `INS-${Date.now()}`, createdAt: new Date().toISOString() }, ...state.inspections],
      })),
      updateInspectionStatus: (inspId, status, data) => set((state) => ({
        inspections: state.inspections.map(i =>
          i.id === inspId ? { ...i, status, ...data, updatedAt: new Date().toISOString() } : i
        ),
      })),

      // ─── Reset ───────────────────────────────────────────────
      resetStore: () => set({
        vehicleDetails: null,
        vehicleValue: 0,
        vehicleUsage: '',
        insuranceType: '',
        selectedInsurers: [],
        quoteStatus: 'idle',
        selectedQuote: null,
        premiumBreakdown: null,
        policyDates: null,
        ncdCode: '',
        ncdCodeValidated: null,
        ncdCodeUsed: false,
        coverageDurationId: '4q',
        quoteRulesAgreed: false,
        documents: {
          whiteBook: null,
          insp_front: null, insp_back: null, insp_left: null, insp_right: null, insp_mileage: null,
        },
      }),
    }),
    {
      name: 'insurshield-storage',
      partialize: (state) => ({
        userPhone: state.userPhone,
        customer: state.customer,
        isAuthenticated: state.isAuthenticated,
        registeredAccounts: state.registeredAccounts,
        quoteRequests: state.quoteRequests,
        policies: state.policies,
        vehicleDetails: state.vehicleDetails,
        vehicleValue: state.vehicleValue,
        vehicleUsage: state.vehicleUsage,
        insuranceType: state.insuranceType,
        selectedInsurers: state.selectedInsurers,
        quoteStatus: state.quoteStatus,
        selectedQuote: state.selectedQuote,
        premiumBreakdown: state.premiumBreakdown,
        policyDates: state.policyDates,
        ncdCode: state.ncdCode,
        ncdCodeValidated: state.ncdCodeValidated,
        ncdCodeUsed: state.ncdCodeUsed,
        coverageDurationId: state.coverageDurationId,
        policyStartDate: state.policyStartDate,
        consentAccepted: state.consentAccepted,
        consentTimestamp: state.consentTimestamp,
        consentRecord: state.consentRecord,
        quoteRulesAgreed: state.quoteRulesAgreed,
        quoteRulesTimestamp: state.quoteRulesTimestamp,
        piaConfig: state.piaConfig,
        insurersList: state.insurersList,
        claims: state.claims,
        supportTickets: state.supportTickets,
        chatMessages: state.chatMessages,
        inspections: state.inspections,
        documents: state.documents,
        ncdApplications: state.ncdApplications,
      }),
    }
  )
);
