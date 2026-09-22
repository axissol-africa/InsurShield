/**
 * Demo records for the insurer portal.
 *
 * They live in the store like real records so every portal action (mark a
 * claim received, approve an NCD application, issue a certificate) works on
 * them exactly as it would on customer-submitted data. Timestamps are relative
 * to first load and then persist unchanged.
 */

const DEMO_INSURER = 'Prestige Assurance';
const DEMO_CUSTOMER = { fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm' };

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

export const SEED_CLAIMS = [
  {
    id: 'CLM-882031', claimNumber: 'CLM-882031', ...DEMO_CUSTOMER,
    insurer: DEMO_INSURER, type: 'Accident / Collision', plate: 'BAA 1234', vehicle: '2020 Toyota Hilux',
    incidentDate: '2025-06-10', location: 'Great East Road, near Arcades',
    description: 'Rear-ended at traffic lights. Third party vehicle fled the scene.',
    estimatedLoss: '45000', policeReport: true, policeReportNumber: 'ZP/2025/4421',
    status: 'Received by insurer', submittedAt: daysAgo(4), receivedAt: daysAgo(3),
  },
  {
    id: 'CLM-774510', claimNumber: 'CLM-774510', phone: '0977334455', fullName: 'Chanda Phiri',
    insurer: DEMO_INSURER, type: 'Theft', plate: 'ABZ 5521', vehicle: '2018 Toyota Corolla',
    incidentDate: '2025-06-15', location: 'Woodlands, Lusaka',
    description: 'Vehicle stolen from outside residence overnight.',
    estimatedLoss: '95000', policeReport: true, policeReportNumber: 'ZP/2025/5820',
    status: 'Notified', submittedAt: daysAgo(1),
  },
];

export const SEED_NCD_APPLICATIONS = [
  {
    id: 'NCDA-991200', applicationNumber: 'NCDA-991200', phone: DEMO_CUSTOMER.phone, fullName: DEMO_CUSTOMER.fullName,
    insurer: DEMO_INSURER, policyNumber: 'PA-2023-0045', yearsClaimFree: 2, status: 'Submitted', submittedAt: daysAgo(3), approvedCode: null,
  },
  {
    id: 'NCDA-882204', applicationNumber: 'NCDA-882204', phone: '0955001122', fullName: 'Thandiwe Zulu',
    insurer: DEMO_INSURER, policyNumber: 'PA-2022-0188', yearsClaimFree: 3, status: 'Under Review', submittedAt: daysAgo(7), approvedCode: null,
  },
];

const ALL_INSURERS = ['Prestige Assurance', 'Global Guard Insurance', 'ValueDirect Insurance', 'Metro Safe Assurance', 'Madison General'];
const ALL_INSURER_IDS = ['1', '2', '3', '4', '5'];

const quoteRequest = ({ id, minutesOld, customer, vehicle, plate, value, usage, insuranceType }) => {
  const submittedAt = minutesAgo(minutesOld);
  const [year, make, ...model] = vehicle.split(' ');
  return {
    id, status: 'Submitted', submittedAt, expiresAt: new Date(new Date(submittedAt).getTime() + 14 * 86_400_000).toISOString(),
    customer, insurers: ALL_INSURERS, insurerIds: ALL_INSURER_IDS, insurerQuotes: {},
    vehicle, vehicleDetails: { plateNumber: plate, make, model: model.join(' '), year },
    vehicleValue: value, vehicleUsage: usage, insuranceType, coverageDurationId: '4q', policyDates: null,
    inspectionShots: ['insp_front', 'insp_rear', 'insp_left', 'insp_right', 'insp_dashboard', 'insp_chassis', 'insp_stereo'], photosCapturedAt: submittedAt,
  };
};

/** Open requests from other customers so the insurer queue is never empty in a demo. */
export const SEED_QUOTE_REQUESTS = [
  quoteRequest({ id: 'QR-9901', minutesOld: 2, customer: { fullName: 'Bwalya Mutale', phone: '0966123456', email: 'bwalya.mutale@example.zm' }, vehicle: '2024 Toyota Hilux', plate: 'BAZ 9901', value: 520000, usage: 'Individual', insuranceType: 'Comprehensive' }),
  quoteRequest({ id: 'QR-9895', minutesOld: 15, customer: { fullName: 'Natasha Mwansa', phone: '0955998877', email: 'natasha.mwansa@example.zm' }, vehicle: '2022 BMW X5', plate: 'ALX 4471', value: 685000, usage: 'Commercial (Cars for Hire)', insuranceType: 'Comprehensive' }),
  quoteRequest({ id: 'QR-9890', minutesOld: 60, customer: { fullName: 'Kondwani Tembo', phone: '0977554433', email: 'k.tembo@example.zm' }, vehicle: '2019 Toyota Hilux', plate: 'ABJ 2210', value: 250000, usage: 'Commercial (Trucks, Horses & Trailers)', insuranceType: 'ThirdParty' }),
];

/** A paid quote waiting for the insurer to upload its certificate. */
export const SEED_POLICIES = [
  {
    policyNumber: 'PA-2026-011293', quoteRequestId: 'QR-1789714666139', insurerQuoteReference: 'PA-Q-2026-00412',
    insurer: DEMO_INSURER, status: 'Awaiting insurer certificate', paymentStatus: 'Paid',
    customerName: DEMO_CUSTOMER.fullName, customerPhone: DEMO_CUSTOMER.phone, customerEmail: DEMO_CUSTOMER.email,
    vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BBC 567' }, coverage: 'Comprehensive', plan: 'Comprehensive Gold Plan',
    premium: 1200, policyDates: { formattedStart: '10 Sep 2026', formattedEnd: '10 Dec 2026' }, receivedAt: minutesAgo(18),
    paymentProof: { transactionId: 'TXN-MTN-1789714666139', status: 'Confirmed', method: 'Mobile money', amount: 1200, currency: 'ZMW', confirmedAt: minutesAgo(18) },
  },
];

/** Append any seed record the stored list does not already hold (matched on `key`). */
export const withSeed = (records, seeds, key = 'id') => {
  const existing = Array.isArray(records) ? records : [];
  const known = new Set(existing.map((record) => record[key]));
  return [...existing, ...seeds.filter((seed) => !known.has(seed[key]))];
};
