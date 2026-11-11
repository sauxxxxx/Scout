import { describe, expect, it } from 'vitest';
import { businessTokens, contactPageUrls, contactsForBusiness, decodeCloudflareEmail, extractContacts, isOwnSite } from '@/lib/website-contacts';

const site = 'https://www.smiledental.ph/';

describe('finding contact details on a business website', () => {
  it('reads plain-text emails, not only clickable links, and prefers the business’s own domain', () => {
    const page = '<footer>Email us: hello@gmail.com or bookings@smiledental.ph</footer>';
    expect(extractContacts([page], site)).toMatchObject({ email: 'bookings@smiledental.ph', emails: ['bookings@smiledental.ph', 'hello@gmail.com'] });
  });

  it('undoes the spellings people use to hide emails from spam bots', () => {
    expect(extractContacts(['<p>sales [at] smiledental [dot] ph</p>'], site).email).toBe('sales@smiledental.ph');
    expect(extractContacts(['<p>info(at)smiledental(dot)ph</p>'], site).email).toBe('info@smiledental.ph');
    expect(extractContacts(['<p>info&#64;smiledental&#46;ph</p>'], site).email).toBe('info@smiledental.ph');
  });

  it('decodes emails that Cloudflare hides on the sites it protects', () => {
    const key = 0x42;
    const hex = key.toString(16) + [...'hi@clinic.ph'].map(char => (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
    expect(decodeCloudflareEmail(hex)).toBe('hi@clinic.ph');
    expect(extractContacts([`<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a>`], site).email).toBe('hi@clinic.ph');
  });

  it('reads the structured business details sites publish for Google', () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Smile Dental","telephone":"+63 32 123 4567","email":"frontdesk@smiledental.ph","sameAs":["https://www.facebook.com/smiledentalcebu","https://www.instagram.com/smiledentalcebu/"]}</script>`;
    expect(extractContacts([page], site)).toMatchObject({ email: 'frontdesk@smiledental.ph', phone: '+63 32 123 4567', socialUrl: 'https://www.facebook.com/smiledentalcebu', channels: { instagram: 'https://www.instagram.com/smiledentalcebu/' } });
  });

  it('collects Messenger, Viber and WhatsApp links, and gets the Facebook page from Messenger', () => {
    const page = '<a href="https://m.me/smiledentalcebu">Chat</a><a href="viber://chat?number=%2B639171234567">Viber</a><a href="https://api.whatsapp.com/send?phone=639171234567&text=hi">WhatsApp</a><a href="tel:+639171234567">Call</a>';
    expect(extractContacts([page], site)).toMatchObject({
      phone: '+639171234567',
      socialUrl: 'https://www.facebook.com/smiledentalcebu',
      channels: { messenger: 'https://m.me/smiledentalcebu', viber: 'viber://chat?number=%2B639171234567', whatsapp: 'https://wa.me/639171234567' },
    });
  });

  it('ignores image names, placeholders and tracking addresses that look like emails', () => {
    const page = '<img src="logo@2x.png"><p>you@example.com</p><script>"dsn":"abc@o123.ingest.sentry.io"</script><p>name@domain.com</p>';
    expect(extractContacts([page], site).emails).toEqual([]);
  });

  it('ignores Instagram posts and Facebook share links that are not the business’s own page', () => {
    const page = '<a href="https://www.instagram.com/p/C1abc/">post</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>';
    expect(extractContacts([page], site)).toMatchObject({ socialUrl: '', channels: {} });
  });
});

describe('choosing which pages to read', () => {
  const root = new URL(site);
  it('follows contact-type links by their address or their text, on the same site only', () => {
    const homepage = '<a href="/reach-us">Contact</a><a href="/about">About us</a><a href="https://other.com/contact">Partner</a><a href="/services">Services</a>';
    expect(contactPageUrls(homepage, '', root)).toEqual(['https://www.smiledental.ph/reach-us', 'https://www.smiledental.ph/about', 'https://www.smiledental.ph/contact']);
  });

  it('uses the sitemap when the homepage links no contact page', () => {
    const sitemap = '<urlset><url><loc>https://www.smiledental.ph/our-branches</loc></url><url><loc>https://www.smiledental.ph/blog/teeth</loc></url></urlset>';
    expect(contactPageUrls('<a href="/services">Services</a>', sitemap, root)[0]).toBe('https://www.smiledental.ph/our-branches');
  });
});

describe('telling a business’s own site from a listing page', () => {
  it('picks the words that identify a business', () => {
    expect(businessTokens('AMG Dental Clinic Cebu')).toEqual(['amg', 'adcc']);
    expect(businessTokens('Smile Dental Cebu')).toEqual(['smile', 'sdc']);
    expect(businessTokens('RnB Dental Clinic')).toEqual(['rnb', 'rdc']);
  });

  it('trusts a site whose address names the business, or a homepage Google pointed to', () => {
    expect(isOwnSite('https://www.smiledental.ph/contact', 'Smile Dental Cebu')).toBe(true);
    expect(isOwnSite('https://amgdental.com/', 'AMG Dental Clinic Cebu')).toBe(true);
    expect(isOwnSite('https://drcruzclinic.com/', 'Bright Teeth Center')).toBe(true);
  });

  it('treats a deep page on someone else’s site as a listing page', () => {
    expect(isOwnSite('https://cebudentalimplants.com/content/amg-dental-clinic-cebu-ma-christina-building-cebu-city', 'AMG Dental Clinic Cebu')).toBe(false);
  });

  it('keeps only details that name the business when the page is a listing', () => {
    const page = '<p>esldentalclinic@gmail.com · amgdental.cebu@gmail.com</p><a href="tel:+63 32 111 2222">Call</a><a href="https://www.facebook.com/amgdentalclinic01">AMG</a><a href="https://www.facebook.com/esldentalclinic">ESL</a><a href="https://m.me/esldentalclinic">Chat</a><a href="https://wa.me/639171112222">WhatsApp</a>';
    const listing = 'https://cebudentalimplants.com/content/amg-dental-clinic-cebu';
    const result = contactsForBusiness(extractContacts([page], listing), listing, 'AMG Dental Clinic Cebu');
    expect(result).toMatchObject({ ownSite: false, email: 'amgdental.cebu@gmail.com', emails: ['amgdental.cebu@gmail.com'], phone: '', socialUrl: 'https://www.facebook.com/amgdentalclinic01', channels: {} });
  });

  it('leaves everything on the business’s own site', () => {
    const page = '<p>hello@gmail.com</p><a href="tel:+63 32 111 2222">Call</a>';
    const result = contactsForBusiness(extractContacts([page], 'https://www.smiledental.ph/'), 'https://www.smiledental.ph/', 'Smile Dental Cebu');
    expect(result).toMatchObject({ ownSite: true, email: 'hello@gmail.com', phone: '+63 32 111 2222' });
  });
});
