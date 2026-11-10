import { describe, expect, it } from 'vitest';
import { nameFromPageUrl, parseFacebookLines } from '@/lib/facebook-bulk';

describe('adding Facebook pages in bulk', () => {
  it('reads a link alone, or a name and link copied from a sheet or typed with a comma or dash', () => {
    const { rows, problems } = parseFacebookLines([
      'https://www.facebook.com/SmileDentalCebu',
      'Ana Salon\thttps://facebook.com/anasalon.davao',
      'Ben Spa, facebook.com/benspa',
      'Cara Nails - https://m.facebook.com/caranails/',
    ].join('\n'));
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { line: 1, name: 'Smile Dental Cebu', facebookUrl: 'https://www.facebook.com/SmileDentalCebu' },
      { line: 2, name: 'Ana Salon', facebookUrl: 'https://www.facebook.com/anasalon.davao' },
      { line: 3, name: 'Ben Spa', facebookUrl: 'https://www.facebook.com/benspa' },
      { line: 4, name: 'Cara Nails', facebookUrl: 'https://www.facebook.com/caranails' },
    ]);
  });

  it('says why a line was left out', () => {
    const { rows, problems } = parseFacebookLines('Just a name\nhttps://www.facebook.com/groups/davaobiz\nhttps://www.facebook.com/profile.php?id=1000123\nhttps://facebook.com/benspa\nBen Spa again https://www.facebook.com/benspa');
    expect(rows).toHaveLength(1);
    expect(problems.map(item => [item.line, item.reason])).toEqual([
      [1, 'No Facebook page link'],
      [2, 'Not a business page link (a post, group or share link)'],
      [3, 'Add the business name before the link'],
      [5, 'Repeated in the list'],
    ]);
  });

  it('keeps a typed name for pages whose address has no name in it', () => {
    expect(parseFacebookLines('Dra. Cruz Clinic\thttps://www.facebook.com/profile.php?id=1000123').rows[0]).toMatchObject({ name: 'Dra. Cruz Clinic' });
  });

  it('turns page addresses into readable names', () => {
    expect(nameFromPageUrl('https://www.facebook.com/smile.dental-cebu')).toBe('Smile Dental Cebu');
    expect(nameFromPageUrl('https://www.facebook.com/BGCDentalHub')).toBe('BGC Dental Hub');
    expect(nameFromPageUrl('https://www.facebook.com/profile.php?id=1')).toBe('');
  });

  it('stops at 50 pages and says how many were left out', () => {
    const many = Array.from({ length: 53 }, (_, index) => `https://facebook.com/shop${String.fromCharCode(97 + (index % 26))}${index}x`).join('\n');
    const result = parseFacebookLines(many);
    expect(result.rows).toHaveLength(50);
    expect(result.extra).toBe(3);
  });
});
