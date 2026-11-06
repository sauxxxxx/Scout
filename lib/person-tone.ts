export const PERSON_TONES = 8;

type Person = { id: string; name: string; avatarUrl?: string; joinedAt?: string; pending?: boolean };
export type PersonLook = { tone: number; avatarUrl?: string };

/** Someone no longer on the team still gets a steady colour, worked out from their name. */
export function toneFromName(name: string) {
  let total = 0;
  for (const letter of name) total = (total * 31 + letter.charCodeAt(0)) >>> 0;
  return total % PERSON_TONES + 1;
}

/** Colours go out in the order people joined, so nobody shares one until the team passes eight. */
export function peopleLooks(members: Person[]) {
  const joined = members.filter(member => !member.pending).sort((a, b) => (a.joinedAt || '').localeCompare(b.joinedAt || '') || a.id.localeCompare(b.id));
  return new Map<string, PersonLook>(joined.map((member, index) => [member.name, { tone: index % PERSON_TONES + 1, avatarUrl: member.avatarUrl }]));
}
