export const INSPECTION_PHOTO_SLOTS = [
  ['front', 'Front view'], ['rear', 'Rear view'], ['left', 'Left side'],
  ['right', 'Right side'], ['dashboard', 'Dashboard and mileage'], ['engine_bay', 'Engine bay'],
];
export const laterInspection = (inspection) => ['AFTER_PAYMENT', 'CLAIM_ASSESSMENT'].includes(inspection.purpose);
export const inspectionStatus = (inspection) => String(inspection.status || '').replaceAll(' ', '_').toUpperCase();
export const inspectionClosed = (inspection) => ['APPROVED', 'FAILED', 'NO_SHOW', 'MISSED', 'CANCELLED'].includes(inspectionStatus(inspection));
export const inspectionPurpose = (inspection) => ({ AFTER_PAYMENT: 'After-payment inspection', CLAIM_ASSESSMENT: 'Claim assessment', UNDERWRITING: 'Quotation inspection' }[inspection.purpose] || 'Vehicle inspection');
export const inspectionNextAction = (inspection, staff = false) => {
  const status = inspectionStatus(inspection);
  if (status === 'APPROVED') return 'Inspection approved. The saved evidence and report remain available.';
  if (['FAILED', 'NO_SHOW', 'MISSED', 'CANCELLED'].includes(status)) return 'This attempt has ended. Contact the insurer about the next attempt.';
  if (status === 'REPORT_READY' || inspection.report) return staff ? 'Review the published report, then record the outcome.' : 'Your report is ready. The insurer will record the outcome.';
  if (inspection.method === 'PHYSICAL' && status === 'REQUESTED') return staff ? 'Book the physical inspection before publishing its report.' : 'The insurer will arrange an appointment for your physical inspection.';
  if (!staff && inspection.method === 'SELF_CAPTURE' && INSPECTION_PHOTO_SLOTS.every(([slot]) => inspection.photos?.some((photo) => photo.slot === slot))) return 'All requested views are saved. The insurer will prepare the report.';
  if (staff) return 'Collect inspection evidence and attach the final report before approving.';
  return inspection.method === 'SELF_CAPTURE' ? 'Submit the requested vehicle photos below. The insurer will prepare a report.' : 'Attend the arranged inspection. You can add supporting vehicle photos below.';
};
