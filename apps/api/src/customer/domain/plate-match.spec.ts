import { findVehicleByPlate, plateSearchPrefix } from './plate-match.js';

describe('plate matching', () => {
  const vehicles = [
    { id: 'spaced', plateNumber: 'BAA 1234' },
    { id: 'lower', plateNumber: 'baz9901' },
    { id: 'other', plateNumber: 'BAA 1235' },
  ];

  it('finds the vehicle whatever the spacing or case of either plate', () => {
    expect(findVehicleByPlate(vehicles, 'baa1234')?.id).toBe('spaced');
    expect(findVehicleByPlate(vehicles, 'BAZ 9901')?.id).toBe('lower');
    expect(findVehicleByPlate(vehicles, ' BAA  1235 ')?.id).toBe('other');
  });

  it('finds nothing for a plate that is not on file', () => {
    expect(findVehicleByPlate(vehicles, 'BAA 1236')).toBeUndefined();
    expect(findVehicleByPlate([], 'BAA 1234')).toBeUndefined();
  });

  it('narrows candidates by the first three characters of the compact plate', () => {
    expect(plateSearchPrefix('baa 1234')).toBe('BAA');
    expect(plateSearchPrefix(' ab ')).toBe('AB');
  });
});
