import { DEFAULT_COUNTRY } from '@/lib/countries';

const callingCodes: Record<string, string> = { PH: '63', SG: '65', MY: '60', ID: '62', TH: '66', VN: '84', US: '1', CA: '1', GB: '44', AU: '61', NZ: '64', AE: '971', JP: '81', KR: '82', HK: '852', IN: '91' };

/**
 * One comparable form of a phone number, so "0917 123 4567", "+63 917-123-4567" and "639171234567" match.
 * Returns '' for anything too short to be a real number, so blanks and extensions never match each other.
 */
export function phoneKey(value: string | null | undefined, country: string = DEFAULT_COUNTRY) {
  const raw = String(value || '').split(/\s*(?:ext\.?|x|loc\.?|local)\s*\d+\s*$/i)[0];
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const code = callingCodes[country] || '';
  if (raw.trim().startsWith('+')) return digits.length >= 8 ? digits : '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (code && digits.startsWith(code) && digits.length > code.length + 6) { /* already international */ }
  else if (code) digits = code + digits.replace(/^0+/, '');
  return digits.length >= 8 ? digits : '';
}
