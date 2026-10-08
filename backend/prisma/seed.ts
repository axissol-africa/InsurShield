/**
 * Reference data the platform cannot run without: the PIA regulatory floor, the
 * approved insurer list and the NCD codes those insurers have issued.
 *
 * Mirrors `frontend/src/domain/insurers.js` so mock mode and http mode agree.
 * Every write is an upsert, so this is safe to re-run against any environment.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  InspectionMethod,
  InspectionRule,
  InspectionTiming,
  StaffRole,
} from '../src/generated/prisma/enums.js';
import { hashPassword } from '../src/common/auth/password.js';
import { resetDemoData, seedDemoData } from './demo-data.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** PIA minimum: no insurer may quote below this percentage of vehicle value. */
const PIA_RATE_PERCENTAGE = 4;

const INSURERS = [
  {
    name: 'Prestige Assurance',
    coverage: 'Comprehensive Gold Plan',
    ratePercentage: 4.5,
    quoteValidityDays: 7,
    ncdAccepted: true,
    inspectionRule: InspectionRule.NOT_REQUIRED,
    inspectionTiming: InspectionTiming.AFTER_PAYMENT,
    inspectionMethod: InspectionMethod.SELF_CAPTURE,
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
    inspectionRule: InspectionRule.REQUIRED,
    inspectionTiming: InspectionTiming.BEFORE_QUOTATION,
    inspectionMethod: InspectionMethod.PHYSICAL,
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
    inspectionRule: InspectionRule.OPTIONAL,
    inspectionTiming: InspectionTiming.BEFORE_PAYMENT,
    inspectionMethod: InspectionMethod.SELF_CAPTURE,
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
    inspectionRule: InspectionRule.REQUIRED,
    inspectionTiming: InspectionTiming.BEFORE_QUOTATION,
    inspectionMethod: InspectionMethod.SELF_CAPTURE,
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
    inspectionRule: InspectionRule.OPTIONAL,
    inspectionTiming: InspectionTiming.AFTER_PAYMENT,
    inspectionMethod: InspectionMethod.SELF_CAPTURE,
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

/**
 * Staff accounts for the admin and insurer portals.
 *
 * The password comes from SEED_STAFF_PASSWORD so a real environment can seed
 * its own; the fallback exists only to make a local checkout usable and must
 * never be relied on anywhere reachable from the internet.
 */
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'insurshield-dev';

async function main(): Promise<void> {
  await prisma.piaConfig.upsert({
    where: { id: 'current' },
    create: { id: 'current', piaRatePercentage: PIA_RATE_PERCENTAGE },
    update: { piaRatePercentage: PIA_RATE_PERCENTAGE },
  });
  console.log(`PIA minimum rate set to ${PIA_RATE_PERCENTAGE}% of declared vehicle value`);

  for (const { contact, ncdCodes, ...insurer } of INSURERS) {
    const record = await prisma.insurer.upsert({
      where: { name: insurer.name },
      create: { ...insurer, contact: { create: contact } },
      update: { ...insurer, contact: { upsert: { create: contact, update: contact } } },
    });

    for (const ncdCode of ncdCodes) {
      await prisma.ncdCode.upsert({
        where: { code: ncdCode.code },
        create: { ...ncdCode, insurerId: record.id },
        update: { ...ncdCode, insurerId: record.id },
      });
    }

    console.log(`Insurer ready: ${record.name} (${insurer.ratePercentage}%)`);
  }

  // ── Staff accounts ────────────────────────────────────────────────
  // Credentials live here now. The password is only written on create, so
  // re-running the seed never silently resets one someone has since changed;
  // SEED_RESET_PASSWORDS=true forces it back to the seed password.
  const resetPasswords = process.env.SEED_RESET_PASSWORDS === 'true';
  const seedPassword = await hashPassword(STAFF_PASSWORD);
  const passwordUpdate = resetPasswords ? { passwordHash: seedPassword } : {};

  await prisma.staffUser.upsert({
    where: { email: 'admin@insurshield.zm' },
    create: {
      email: 'admin@insurshield.zm',
      fullName: 'InsurShield Administrator',
      role: StaffRole.SUPER_ADMIN,
      passwordHash: seedPassword,
    },
    update: { role: StaffRole.SUPER_ADMIN, isActive: true, ...passwordUpdate },
  });
  console.log('Staff ready: admin@insurshield.zm (SUPER_ADMIN)');

  // One portal login per insurer, so each sees only its own work.
  const insurers = await prisma.insurer.findMany({
    where: { status: { not: 'DELETED' } },
    select: { id: true, name: true },
  });
  for (const insurer of insurers) {
    const slug = insurer.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const email = `insurer@${slug}.zm`;
    await prisma.staffUser.upsert({
      where: { email },
      create: {
        email,
        fullName: `${insurer.name} portal`,
        role: StaffRole.INSURER_USER,
        insurerId: insurer.id,
        passwordHash: seedPassword,
      },
      update: { insurerId: insurer.id, isActive: true, ...passwordUpdate },
    });
    console.log(`Staff ready: ${email} (INSURER_USER)`);
  }

  if (!process.env.SEED_STAFF_PASSWORD) {
    console.log('\nStaff password: insurshield-dev  (set SEED_STAFF_PASSWORD to override)');
  }

  // Records for the portals to work on locally. Never in production.
  // SEED_RESET_DEMO=true clears anything done to them and starts over.
  if (process.env.SEED_DEMO_DATA !== 'false') {
    if (process.env.SEED_RESET_DEMO === 'true') {
      await resetDemoData(prisma);
      console.log('Demo data reset.');
    }
    await seedDemoData(prisma);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
