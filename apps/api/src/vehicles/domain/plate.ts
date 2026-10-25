/** Plates are stored and compared without spacing or case, e.g. "baa1234". */
export const comparablePlate = (plate: string) => plate.replace(/\s+/g, '').toUpperCase();

/** Display form: three letters, a space, then the digits — "BAA 1234". */
export const displayPlate = (plate: string) => {
  const compact = comparablePlate(plate);
  const parts = compact.match(/^([A-Z]+)(\d+)$/);
  return parts ? `${parts[1]} ${parts[2]}` : compact;
};
