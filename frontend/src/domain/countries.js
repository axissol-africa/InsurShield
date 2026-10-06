/**
 * Countries a vehicle can be registered in.
 *
 * Manual entry exists for vehicles the RTSA register cannot answer for: an
 * import that has not been registered yet, one mid-transfer between owners, or
 * a foreign-plated vehicle driven in from a neighbour. For all of those the
 * country the plate belongs to changes how an insurer reads every other field,
 * so it is asked for explicitly rather than assumed to be Zambia.
 *
 * The list is reference data, not configuration: countries change rarely and
 * an insurer adding one is not a business decision anybody should be making in
 * an admin screen. `OTHER` covers what the world does next.
 */

/** Where these vehicles actually come from, first — the rest is alphabetical. */
const COMMON = [
  'Zambia',
  'Botswana',
  'Democratic Republic of the Congo',
  'Malawi',
  'Mozambique',
  'Namibia',
  'South Africa',
  'Tanzania',
  'Zimbabwe',
  'Japan',
  'United Kingdom',
  'United Arab Emirates',
];

const REST = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina',
  'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Brazil',
  'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica',
  "Côte d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
  'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany',
  'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malaysia',
  'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Myanmar', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia',
  'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay',
  'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone',
  'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Korea', 'South Sudan',
  'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Tajikistan',
  'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Vatican City', 'Venezuela', 'Vietnam', 'Yemen',
];

/** The value the select carries when the country is not on the list. */
export const OTHER = 'Other';

/** Matches the column and the API contract, so a name that saves here saves everywhere. */
export const MAX_COUNTRY_LENGTH = 60;
const MIN_COUNTRY_LENGTH = 2;

/** The country a vehicle defaults to, this being a Zambian marketplace. */
export const DEFAULT_COUNTRY = 'Zambia';

/** Grouped for the select: the handful that cover most vehicles, then the rest. */
export const COUNTRY_GROUPS = [
  { label: 'Common', countries: COMMON },
  { label: 'All countries', countries: [...REST].sort((first, second) => first.localeCompare(second)) },
];

export const COUNTRIES = [...COMMON, ...COUNTRY_GROUPS[1].countries];

/**
 * Settle what to store from the two controls.
 *
 * Returns the country to save, or the reason it cannot be saved. Typing a
 * country that is already on the list is accepted rather than corrected: the
 * customer is telling us where the vehicle is from, and arguing with them
 * about spelling helps nobody.
 *
 * @param {string} selection  the chosen option, or `OTHER`
 * @param {string} typed      what was typed when `OTHER` is chosen
 * @returns {{ country: string|null, error: string }}
 */
export function resolveCountry(selection, typed = '') {
  if (selection !== OTHER) {
    return COUNTRIES.includes(selection)
      ? { country: selection, error: '' }
      : { country: null, error: 'Choose the country the vehicle is registered in.' };
  }

  // Collapse runs of whitespace so "  South   Sudan " is one tidy name.
  const country = typed.trim().replace(/\s+/g, ' ');
  if (country.length < MIN_COUNTRY_LENGTH) return { country: null, error: 'Type the country the vehicle is registered in.' };
  if (country.length > MAX_COUNTRY_LENGTH) return { country: null, error: `A country name cannot be longer than ${MAX_COUNTRY_LENGTH} characters.` };
  if (!/[\p{L}]/u.test(country)) return { country: null, error: 'That does not look like a country name.' };
  return { country, error: '' };
}

/** True when the vehicle is registered somewhere other than Zambia. */
export const isForeignRegistered = (country) => Boolean(country) && country !== DEFAULT_COUNTRY;
