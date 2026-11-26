import { env } from '@/config/env';
import { ncdDiscountForYears } from '@/domain/insurers';

export const ncdVehicleLabel = (vehicle) => [[vehicle.make, vehicle.model].filter(Boolean).join(' '), vehicle.plateNumber]
  .filter(Boolean).join(' · ');

export const applicationDiscount = (application) => application.discountPercentage
  ?? (env.apiMode === 'mock' && application.discountPercentage === undefined ? ncdDiscountForYears(application.yearsClaimFree) : null);
export const discountLabel = (application) => {
  const percentage = applicationDiscount(application);
  return percentage === null ? 'Insurer verification needed' : `${percentage}%`;
};
export const isUsableNcd = (application, now) => application.status === 'Approved'
  && (application.codeStatus === 'Available' || (env.apiMode === 'mock' && application.codeStatus === undefined))
  && Boolean(application.approvedCode) && applicationDiscount(application) !== null
  && (!application.expiresAt || new Date(application.expiresAt).getTime() > now);
