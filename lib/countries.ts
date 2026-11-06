export const DEFAULT_COUNTRY = 'PH';

const codes = `AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS XK YE YT ZA ZM ZW`.split(' ');

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export const isCountry = (code?: string | null) => !!code && codes.includes(code);
export const countryName = (code?: string | null) => names.of(isCountry(code) ? code! : DEFAULT_COUNTRY) || DEFAULT_COUNTRY;

/** The Philippines comes first because most searches are there. The rest follow by name. */
export const countryOptions = [DEFAULT_COUNTRY, ...codes.filter(code => code !== DEFAULT_COUNTRY).sort((a, b) => countryName(a).localeCompare(countryName(b)))];

/** Philippine records stay as they always were, so only other countries are named. */
export const placeLabel = (place: string, country?: string | null) => (!country || country === DEFAULT_COUNTRY || place === countryName(country) ? place : [place, countryName(country)].filter(Boolean).join(', '));

/** Tells Google which country a search is about. Philippine searches send nothing extra, so their results don't change. */
export const placesRegion = (country?: string | null) => (!country || country === DEFAULT_COUNTRY ? {} : { regionCode: country, languageCode: 'en' });
