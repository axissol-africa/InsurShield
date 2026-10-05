import { describe, expect, it } from 'vitest';
import {
  COUNTRIES, COUNTRY_GROUPS, DEFAULT_COUNTRY, MAX_COUNTRY_LENGTH, OTHER,
  isForeignRegistered, resolveCountry,
} from './countries';

describe('the country list', () => {
  it('leads with the countries these vehicles actually come from', () => {
    expect(COUNTRY_GROUPS[0].countries.slice(0, 3)).toEqual(['Zambia', 'Botswana', 'Democratic Republic of the Congo']);
  });

  it('lists every other country alphabetically', () => {
    const rest = COUNTRY_GROUPS[1].countries;
    expect(rest).toEqual([...rest].sort((first, second) => first.localeCompare(second)));
  });

  it('names each country once', () => {
    expect(new Set(COUNTRIES).size).toBe(COUNTRIES.length);
  });

  it('never offers "Other" as a country in its own right', () => {
    expect(COUNTRIES).not.toContain(OTHER);
  });
});

describe('resolving the country to save', () => {
  it('takes a country chosen from the list', () => {
    expect(resolveCountry('Japan')).toEqual({ country: 'Japan', error: '' });
  });

  it('defaults to the home market being a valid choice', () => {
    expect(resolveCountry(DEFAULT_COUNTRY).country).toBe('Zambia');
  });

  // A selection that is not on the list means the control was tampered with
  // or the list changed under a stale page; either way it is not saved.
  it('refuses a selection that is not a country', () => {
    expect(resolveCountry('Atlantis')).toEqual({ country: null, error: expect.stringContaining('Choose the country') });
  });

  it('takes a typed country when Other is chosen', () => {
    expect(resolveCountry(OTHER, 'Western Sahara')).toEqual({ country: 'Western Sahara', error: '' });
  });

  it('tidies the spacing around and inside a typed country', () => {
    expect(resolveCountry(OTHER, '  South   Sudan  ').country).toBe('South Sudan');
  });

  it('asks for a country when Other is chosen and nothing is typed', () => {
    expect(resolveCountry(OTHER, '   ').error).toContain('Type the country');
    expect(resolveCountry(OTHER, '').country).toBeNull();
  });

  it('refuses a single character', () => {
    expect(resolveCountry(OTHER, 'X').country).toBeNull();
  });

  it('refuses a name longer than the column can hold', () => {
    const result = resolveCountry(OTHER, 'a'.repeat(MAX_COUNTRY_LENGTH + 1));
    expect(result.country).toBeNull();
    expect(result.error).toContain(String(MAX_COUNTRY_LENGTH));
  });

  it('accepts a name exactly at the limit', () => {
    expect(resolveCountry(OTHER, 'a'.repeat(MAX_COUNTRY_LENGTH)).country).toHaveLength(MAX_COUNTRY_LENGTH);
  });

  it('refuses something with no letters in it', () => {
    expect(resolveCountry(OTHER, '12345').country).toBeNull();
    expect(resolveCountry(OTHER, '!!!').country).toBeNull();
  });

  it('accepts accented and non-Latin names', () => {
    expect(resolveCountry(OTHER, "Côte d'Ivoire").country).toBe("Côte d'Ivoire");
    expect(resolveCountry(OTHER, '日本').country).toBe('日本');
  });
});

describe('spotting a vehicle registered abroad', () => {
  it('is foreign when the country is anything but Zambia', () => {
    expect(isForeignRegistered('Tanzania')).toBe(true);
    expect(isForeignRegistered(DEFAULT_COUNTRY)).toBe(false);
  });

  // Vehicles saved before this field existed have no country at all, and must
  // not start reading as foreign.
  it('is not foreign when nothing was recorded', () => {
    expect(isForeignRegistered(undefined)).toBe(false);
    expect(isForeignRegistered('')).toBe(false);
  });
});
