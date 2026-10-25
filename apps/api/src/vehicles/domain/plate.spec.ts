import { comparablePlate, displayPlate } from './plate.js';

describe('comparablePlate', () => {
  it.each([
    ['BAA 1234', 'BAA1234'],
    [' baa  1234 ', 'BAA1234'],
    ['b a a\t1 2 3 4', 'BAA1234'],
    ['abc-12', 'ABC-12'],
  ])('reads %j as %j', (plate, expected) => {
    expect(comparablePlate(plate)).toBe(expected);
  });
});

describe('displayPlate', () => {
  it.each([
    ['baa1234', 'BAA 1234'],
    [' BAA  1234 ', 'BAA 1234'],
    ['abcd 5', 'ABCD 5'],
    ['abc 12 x', 'ABC12X'],
    ['1234 baa', '1234BAA'],
  ])('shows %j as %j', (plate, expected) => {
    expect(displayPlate(plate)).toBe(expected);
  });
});
