/**
 * Reference data the platform cannot run without: the PIA regulatory floor, the
 * approved insurer list and the NCD codes those insurers have issued.
 *
 * Mirrors `apps/web/src/domain/insurers.js` so mock mode and http mode agree.
 * Every write is an upsert, so this is safe to re-run against any environment.
 */
import type { Transaction } from '../src/db/database.module.js';
import { insurerContacts, insurers, ncdCodes, piaConfig } from '../src/db/schema.js';
import { percentToBps } from '../src/common/money.js';

type NewInsurer = typeof insurers.$inferInsert;

export interface SeedInsurer
  extends Pick<
    NewInsurer,
    | 'name'
    | 'coverage'
    | 'quoteValidityDays'
    | 'ncdAccepted'
    | 'inspectionRule'
    | 'inspectionTiming'
    | 'inspectionMethod'
    | 'icon'
    | 'isBestValue'
    | 'benefits'
  > {
  ratePercentage: number;
  contact: Omit<typeof insurerContacts.$inferInsert, 'insurerId'>;
  ncdCodes: Array<{ code: string; percentage: number; yearsClaimFree: number }>;
}

/** PIA minimum: no insurer may quote below this percentage of vehicle value. */
export const PIA_RATE_PERCENTAGE = 4;

export const INSURERS: SeedInsurer[] = [
  {
    name: 'Prestige Assurance',
    coverage: 'Comprehensive Gold Plan',
    ratePercentage: 4.5,
    quoteValidityDays: 7,
    ncdAccepted: true,
    inspectionRule: 'NOT_REQUIRED',
    inspectionTiming: 'AFTER_PAYMENT',
    inspectionMethod: 'SELF_CAPTURE',
    icon: 'verified',
    isBestValue: true,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 50,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Natural Disasters',
      'Windscreen Replacement',
    ],
    contact: {
      tagline: 'Premium motor cover since 1995',
      contactPerson: 'Mrs. Chanda Mwale',
      role: 'Motor Claims Manager',
      phone: '+260 211 255 100',
      mobile: '+260 977 255 100',
      whatsapp: '260977255100',
      email: 'claims@prestigeassurance.zm',
      address: 'Prestige House, Cairo Road, Lusaka',
      hours: 'Mon–Fri 08:00–17:00 · Sat 09:00–12:00',
    },
    ncdCodes: [{ code: 'NCD-A1B2C', percentage: 10, yearsClaimFree: 1 }],
  },
  {
    name: 'Global Guard Insurance',
    coverage: 'Elite Security Policy',
    ratePercentage: 4.0,
    quoteValidityDays: 2,
    ncdAccepted: true,
    inspectionRule: 'REQUIRED',
    inspectionTiming: 'BEFORE_QUOTATION',
    inspectionMethod: 'PHYSICAL',
    icon: 'shield',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 30,000',
      'Theft & Fire Coverage',
      'Own Damage',
      '24/7 Roadside Assistance',
    ],
    contact: {
      tagline: 'Nationwide cover, fast claims',
      contactPerson: 'Mr. Bwalya Kapasa',
      role: 'Claims Officer',
      phone: '+260 211 374 700',
      mobile: '+260 966 374 700',
      whatsapp: '260966374700',
      email: 'claims@globalguard.zm',
      address: 'Global House, Plot 64489, Lusaka Central',
      hours: 'Mon–Fri 08:00–17:00 · Sat 08:30–12:30',
    },
    ncdCodes: [{ code: 'NCD-D3E4F', percentage: 20, yearsClaimFree: 2 }],
  },
  {
    name: 'ValueDirect Insurance',
    coverage: 'Essential Shield',
    ratePercentage: 4.2,
    quoteValidityDays: 5,
    ncdAccepted: true,
    inspectionRule: 'OPTIONAL',
    inspectionTiming: 'BEFORE_PAYMENT',
    inspectionMethod: 'SELF_CAPTURE',
    icon: 'account_balance_wallet',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 20,000',
      'Theft & Fire Coverage',
      'Emergency Towing',
    ],
    contact: {
      tagline: 'Straightforward cover at a fair price',
      contactPerson: 'Ms. Natasha Phiri',
      role: 'Customer Claims Advisor',
      phone: '+260 211 228 000',
      mobile: '+260 955 228 000',
      whatsapp: '260955228000',
      email: 'claims@valuedirect.zm',
      address: 'Independence Avenue, Lusaka',
      hours: 'Mon–Fri 07:30–17:00',
    },
    ncdCodes: [{ code: 'NCD-G5H6I', percentage: 30, yearsClaimFree: 3 }],
  },
  {
    name: 'Metro Safe Assurance',
    coverage: 'Standard Protection',
    ratePercentage: 5.0,
    quoteValidityDays: 3,
    ncdAccepted: false,
    inspectionRule: 'REQUIRED',
    inspectionTiming: 'BEFORE_QUOTATION',
    inspectionMethod: 'SELF_CAPTURE',
    icon: 'security',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 75,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Natural Disasters',
      'Legal Assistance',
      'Windscreen & Accessories',
    ],
    contact: {
      tagline: 'Protection for every journey',
      contactPerson: 'Mr. Musonda Tembo',
      role: 'Claims & Underwriting Lead',
      phone: '+260 211 239 500',
      mobile: '+260 971 239 500',
      whatsapp: '260971239500',
      email: 'claims@metrosafe.zm',
      address: 'Farmers House, Central Business District, Lusaka',
      hours: 'Mon–Fri 08:00–17:00 · Sat 09:00–13:00',
    },
    // Metro Safe does not accept NCD codes, so it issues none.
    ncdCodes: [{ code: 'NCD-M9N0P', percentage: 50, yearsClaimFree: 5 }],
  },
  {
    name: 'Madison General',
    coverage: 'Comprehensive Zambia Plan',
    ratePercentage: 4.3,
    quoteValidityDays: 6,
    ncdAccepted: true,
    inspectionRule: 'OPTIONAL',
    inspectionTiming: 'AFTER_PAYMENT',
    inspectionMethod: 'SELF_CAPTURE',
    icon: 'business',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 40,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Roadside Assistance',
    ],
    contact: {
      tagline: "Zambia's most trusted insurer",
      contactPerson: 'Ms. Grace Lungu',
      role: 'Motor Claims Coordinator',
      phone: '+260 211 374 950',
      mobile: '+260 968 374 950',
      whatsapp: '260968374950',
      email: 'motorclaims@madisongeneral.zm',
      address: 'Madison House, Addis Ababa Drive, Longacres, Lusaka',
      hours: 'Mon–Fri 08:00–17:00',
    },
    ncdCodes: [{ code: 'NCD-J7K8L', percentage: 40, yearsClaimFree: 4 }],
  },
];

export async function seedReferenceData(tx: Transaction, log: (line: string) => void): Promise<void> {
  const piaRateBps = percentToBps(PIA_RATE_PERCENTAGE);
  await tx
    .insert(piaConfig)
    .values({ id: 'current', piaRateBps })
    .onConflictDoUpdate({ target: piaConfig.id, set: { piaRateBps } });
  log(`PIA minimum rate set to ${PIA_RATE_PERCENTAGE}% of declared vehicle value`);

  for (const { contact, ncdCodes: codes, ratePercentage, ...insurer } of INSURERS) {
    const values = { ...insurer, rateBps: percentToBps(ratePercentage) };
    const [record] = await tx
      .insert(insurers)
      .values(values)
      .onConflictDoUpdate({ target: insurers.name, set: values })
      .returning({ id: insurers.id, name: insurers.name });

    await tx
      .insert(insurerContacts)
      .values({ ...contact, insurerId: record.id })
      .onConflictDoUpdate({ target: insurerContacts.insurerId, set: contact });

    for (const code of codes) {
      const values = { ...code, insurerId: record.id };
      await tx.insert(ncdCodes).values(values).onConflictDoUpdate({ target: ncdCodes.code, set: values });
    }

    log(`Insurer ready: ${record.name} (${ratePercentage}%)`);
  }
}
