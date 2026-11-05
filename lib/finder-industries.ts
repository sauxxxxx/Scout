export type FinderIndustry = { label: string; googleType?: string; psicCode?: string; group: string };

// A sales-friendly catalog mapped to Google Places types. PSIC codes are broad
// references so reporting can later be aligned with the official PSA taxonomy.
export const finderIndustries: FinderIndustry[] = [
  { label: 'Accounting firms', googleType: 'accounting', psicCode: '6920', group: 'Professional services' },
  { label: 'Advertising agencies', psicCode: '7310', group: 'Professional services' },
  { label: 'Auto repair shops', googleType: 'car_repair', psicCode: '4520', group: 'Automotive' },
  { label: 'Beauty salons', googleType: 'beauty_salon', psicCode: '9602', group: 'Personal services' },
  { label: 'Car dealers', googleType: 'car_dealer', psicCode: '4510', group: 'Automotive' },
  { label: 'Construction companies', psicCode: '4100', group: 'Construction' },
  { label: 'Dental clinics', googleType: 'dentist', psicCode: '8620', group: 'Healthcare' },
  { label: 'Digital marketing agencies', googleType: 'marketing_consultant', psicCode: '7310', group: 'Professional services' },
  { label: 'Event planners', psicCode: '8230', group: 'Events' },
  { label: 'Fitness centers', googleType: 'fitness_center', psicCode: '9311', group: 'Health and fitness' },
  { label: 'Furniture stores', googleType: 'furniture_store', psicCode: '4759', group: 'Retail' },
  { label: 'Hair salons', googleType: 'hair_salon', psicCode: '9602', group: 'Personal services' },
  { label: 'Hardware stores', googleType: 'hardware_store', psicCode: '4752', group: 'Retail' },
  { label: 'Hotels', googleType: 'hotel', psicCode: '5510', group: 'Hospitality' },
  { label: 'Insurance agencies', googleType: 'insurance_agency', psicCode: '6622', group: 'Financial services' },
  { label: 'Law firms', googleType: 'lawyer', psicCode: '6910', group: 'Professional services' },
  { label: 'Medical clinics', googleType: 'medical_clinic', psicCode: '8620', group: 'Healthcare' },
  { label: 'Pet grooming salons', googleType: 'pet_care', psicCode: '9609', group: 'Pet services' },
  { label: 'Pharmacies', googleType: 'pharmacy', psicCode: '4772', group: 'Healthcare' },
  { label: 'Real estate agencies', googleType: 'real_estate_agency', psicCode: '6820', group: 'Real estate' },
  { label: 'Restaurants', googleType: 'restaurant', psicCode: '5610', group: 'Food and beverage' },
  { label: 'Schools', googleType: 'school', psicCode: '8520', group: 'Education' },
  { label: 'Spas', googleType: 'spa', psicCode: '9609', group: 'Personal services' },
  { label: 'Travel agencies', googleType: 'travel_agency', psicCode: '7911', group: 'Travel' },
  { label: 'Veterinary clinics', googleType: 'veterinary_care', psicCode: '7500', group: 'Healthcare' },
  { label: 'Web design companies', psicCode: '6201', group: 'Technology' },
];

export function finderIndustryFor(label: string) {
  return finderIndustries.find(item => item.label.toLowerCase() === label.trim().toLowerCase());
}

// Only Table A values accepted by Places Text Search (New) belong here. Keeping
// this allowlist independent from the UI catalog also protects saved searches
// created with an older or response-only Google type.
const googleTextSearchTypes = new Set([
  'accounting', 'beauty_salon', 'car_dealer', 'car_repair', 'dentist', 'fitness_center',
  'furniture_store', 'hair_salon', 'hardware_store', 'hotel', 'insurance_agency',
  'lawyer', 'marketing_consultant', 'medical_clinic', 'pet_care', 'pharmacy',
  'real_estate_agency', 'restaurant', 'school', 'spa', 'travel_agency', 'veterinary_care',
]);

export function validGooglePlaceType(value?: string) {
  return value && googleTextSearchTypes.has(value) ? value : undefined;
}
