import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type PsgcLocality = { name?: string; code?: string; type?: string; zip_code?: string };
type PsgcArea = { name?: string; code?: string };
let catalogCache: { expires: number; data: PsgcLocality[]; provinces: PsgcArea[]; regions: PsgcArea[] } | undefined;

async function catalog() {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache;
  const options = { headers: { accept: 'application/json', 'user-agent': 'ScoutCRM/1.0' }, signal: AbortSignal.timeout(12000) };
  const [localityResponse, provinceResponse, regionResponse] = await Promise.all([
    fetch('https://psgc.cloud/api/cities-municipalities', options), fetch('https://psgc.cloud/api/provinces', options), fetch('https://psgc.cloud/api/regions', options),
  ]);
  if (!localityResponse.ok || !provinceResponse.ok || !regionResponse.ok) throw new Error('PSGC service unavailable');
  const [localityPayload, provincePayload, regionPayload] = await Promise.all([localityResponse.json(), provinceResponse.json(), regionResponse.json()]);
  catalogCache = {
    expires: Date.now() + 24 * 60 * 60 * 1000,
    data: Array.isArray(localityPayload) ? localityPayload as PsgcLocality[] : [],
    provinces: Array.isArray(provincePayload) ? provincePayload as PsgcArea[] : [],
    regions: Array.isArray(regionPayload) ? regionPayload as PsgcArea[] : [],
  };
  return catalogCache;
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 2) return Response.json({ locations: [] });
  try {
    const normalized = query.toLocaleLowerCase('en-PH');
    const source = await catalog();
    const locations = source.data
      .filter(item => item.name?.trim().toLocaleLowerCase('en-PH').includes(normalized))
      .sort((a, b) => {
        const aName = a.name?.trim().toLocaleLowerCase('en-PH') || '';
        const bName = b.name?.trim().toLocaleLowerCase('en-PH') || '';
        return Number(!aName.startsWith(normalized)) - Number(!bName.startsWith(normalized)) || aName.localeCompare(bName);
      })
      .slice(0, 12)
      .map(item => ({
        code: item.code || '', name: item.name?.trim() || '',
        type: item.type === 'City' ? 'City' : item.type === 'Mun' ? 'Municipality' : item.type || 'Locality',
        zipCode: item.zip_code || '',
        province: source.provinces.find(parent => parent.code?.slice(0, 5) === item.code?.slice(0, 5))?.name?.trim() || '',
        region: source.regions.find(parent => parent.code?.slice(0, 2) === item.code?.slice(0, 2))?.name?.trim() || '',
      }));
    return Response.json({ locations }, { headers: { 'cache-control': 'private, max-age=3600' } });
  } catch {
    return Response.json({ error: 'The Philippine location directory is temporarily unavailable.' }, { status: 503 });
  }
}
