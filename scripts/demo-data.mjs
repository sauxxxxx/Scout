// Fills the LOCAL development database with sample data for demos. It never touches a deployed database.
//   npm run demo          adds sample data, replacing any from an earlier run. Run it again on the day, so "today" stays today.
//   npm run demo:remove   removes it and leaves real records alone.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const directory = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
if (!fs.existsSync(directory)) { console.error('No local database found. Start Scout once with npm run dev, then try again.'); process.exit(1); }
const databaseFile = fs.readdirSync(directory).map(name => `${directory}/${name}`).filter(name => name.endsWith('.sqlite') && !name.endsWith('metadata.sqlite')).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
const db = new DatabaseSync(databaseFile);
db.exec('PRAGMA busy_timeout=8000');

const WORKSPACE = 'scout-default';
// Every sample ID starts like this, which is how removal tells sample data from real data.
const MARK = 'd3300000-0000-4000-8000-';
const uuid = (kind, index) => `${MARK}${kind}${String(index).padStart(11, '0')}`;
const repIds = "'demo-andrea','demo-miguel','demo-bianca','demo-paolo','demo-carla'";

function remove() {
  const marked = `LIKE '${MARK}%'`;
  for (const sql of [
    `DELETE FROM notifications WHERE id ${marked}`,
    `DELETE FROM finder_results WHERE search_id ${marked}`,
    `DELETE FROM finder_searches WHERE id ${marked}`,
    `DELETE FROM tasks WHERE uid ${marked} OR lead_id ${marked}`,
    `DELETE FROM activities WHERE uid ${marked} OR lead_id ${marked}`,
    `DELETE FROM opportunities WHERE id ${marked} OR lead_id ${marked}`,
    `DELETE FROM contacts WHERE id ${marked} OR company_id ${marked}`,
    `DELETE FROM leads WHERE id ${marked}`,
    `DELETE FROM companies WHERE id ${marked}`,
    `DELETE FROM workspace_memberships WHERE user_id IN (${repIds})`,
    `DELETE FROM users WHERE id IN (${repIds})`,
  ]) db.exec(sql);
}

if (process.argv[2] === 'remove') {
  remove();
  const left = db.prepare('SELECT COUNT(*) total FROM leads').get().total;
  console.log(`Sample data removed. ${left} real lead${left === 1 ? '' : 's'} left.`);
  process.exit(0);
}

const seed = { value: 20261106 };
const random = () => { seed.value = (seed.value + 0x6d2b79f5) | 0; let mixed = Math.imul(seed.value ^ (seed.value >>> 15), 1 | seed.value); mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed); return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(random() * list.length)];
const between = (low, high) => low + Math.floor(random() * (high - low + 1));

// Scout's teams work in Manila time, and activity dates are stored as the rep's own clock.
const manilaNow = new Date(Date.now() + 8 * 3600000);
const dayOf = offset => new Date(manilaNow.getTime() + offset * 86400000).toISOString().slice(0, 10);
const clock = (offset, time) => `${dayOf(offset)}T${time}`;
const utcStamp = (offset, hours = 2) => new Date(Date.parse(`${dayOf(offset)}T00:00:00Z`) + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const shortDate = offset => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${dayOf(offset)}T12:00:00Z`));
const nowClock = manilaNow.toISOString().slice(0, 16);
const workHour = () => `${String(between(8, 17)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`;

const owner = db.prepare("SELECT u.id,u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.role='owner' LIMIT 1").get(WORKSPACE);
if (!owner) { console.error('Open Scout once so your account exists, then try again.'); process.exit(1); }

const reps = [['demo-andrea', 'Andrea Santos', 'member', 'Senior Sales Rep'], ['demo-miguel', 'Miguel Reyes', 'member', 'Sales Rep'], ['demo-bianca', 'Bianca Cruz', 'member', 'Sales Rep'], ['demo-paolo', 'Paolo Lim', 'member', 'Account Executive'], ['demo-carla', 'Carla Mendoza', 'admin', 'Sales Manager']];
const sellers = [...reps.map(rep => rep[1]), owner.name];

const markets = [
  ['Dental', ['Dental Studio', 'Dental Care', 'Family Dentists', 'Smile Clinic']],
  ['Spa and wellness', ['Day Spa', 'Wellness Center', 'Massage Lounge']],
  ['Hotels', ['Boutique Hotel', 'Suites', 'Beach Resort']],
  ['Restaurants', ['Kitchen', 'Grill House', 'Cafe', 'Bistro']],
  ['Beauty', ['Hair Salon', 'Aesthetics Clinic', 'Nail Lounge']],
  ['Fitness', ['Fitness Club', 'Yoga Studio', 'CrossFit Box']],
  ['Real estate', ['Realty', 'Property Group']],
  ['Automotive', ['Auto Care', 'Car Detailing']],
];
const places = ['Bayview', 'Sunrise', 'Lotus', 'Harbor', 'Mabolo', 'Golden Palm', 'Seaside', 'Orchid', 'Northpoint', 'Coral', 'Banilad', 'Amihan', 'Summit', 'Island', 'Riverstone', 'Maple', 'Tala', 'Crown', 'Azure', 'Lahug', 'Evergreen', 'Pearl', 'Hillcrest', 'Sampaguita'];
const cities = ['Cebu City', 'Mandaue', 'Lapu-Lapu', 'Talisay', 'Danao'];
const firstNames = ['Maria', 'Jose', 'Ana', 'Ramon', 'Liza', 'Mark', 'Grace', 'Rico', 'Joy', 'Dennis', 'Tess', 'Noel', 'Rose', 'Allan', 'Ivy'];
const lastNames = ['Dela Cruz', 'Garcia', 'Bautista', 'Ramos', 'Villanueva', 'Gonzales', 'Aquino', 'Torres', 'Flores', 'Navarro', 'Castillo', 'Rivera'];
const services = ['Website redesign', 'Social media retainer', 'Online booking system', 'Google Ads management', 'Brand refresh', 'SEO package', 'Facebook ads package', 'Photo and video shoot'];

const probability = { New: 10, Contacted: 25, Interested: 40, 'Follow-up': 50, Proposal: 60, Negotiation: 80, Won: 100, Lost: 0 };
// Status and how long ago it closed. Wins are spread out so every Overview and Reports period has something to show.
const plan = [
  ...Array(24).fill(['New']), ...Array(19).fill(['Contacted']), ...Array(14).fill(['Interested']), ...Array(10).fill(['Follow-up']), ...Array(7).fill(['Proposal']), ...Array(4).fill(['Negotiation']),
  ...[0, 1, 2, 3, 4, 5, 8, 11, 16, 24, 33, 41, 58, 72, 96, 130, 170].map(days => ['Won', days]), ...[2, 9, 19, 37, 66].map(days => ['Lost', days]),
];

const callNotes = ['Connected, asked for a price list', 'Spoke with the owner', 'No answer, left a voicemail', 'Connected, wants a callback next week', 'Interested, reviewing with partner'];
const emailNotes = ['Sent intro and portfolio', 'Sent pricing overview', 'Followed up on the proposal', 'Shared two client examples'];
const noteNotes = ['Prefers Facebook Messenger', 'Budget approved for this quarter', 'Decision maker is the clinic owner', 'Peak season starts next month'];
const meetingNotes = ['Discovery meeting at their office', 'Reviewed the draft plan together', 'Video call with the owner'];

const insert = {
  company: db.prepare('INSERT INTO companies (id,workspace_id,version,name,industry,city,phone,email,website,facebook_status,finder_provider,finder_record_id,business_address,owner,created_at,updated_at) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  contact: db.prepare('INSERT INTO contacts (id,workspace_id,company_id,version,name,title,email,phone,is_primary) VALUES (?,?,?,1,?,?,?,?,1)'),
  lead: db.prepare('INSERT INTO leads (id,workspace_id,company_id,primary_contact_id,version,name,industry,city,status,score,owner,last,next,phone,email,contact,priority,opportunity,value,probability,close_date,archived,created_at,updated_at,changed_at,last_touch_at) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)'),
  opportunity: db.prepare('INSERT INTO opportunities (id,workspace_id,company_id,lead_id,primary_contact_id,version,name,stage,value,probability,close_date,owner,priority,outcome,archived,created_at,updated_at,closed_at,proposal_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,0,?,?,?,?)'),
  activity: db.prepare("INSERT INTO activities (uid,workspace_id,id,version,lead,lead_id,company_id,type,detail,time,owner,status,occurred_at,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,'Completed',?,?,?)"),
  task: db.prepare("INSERT INTO tasks (uid,workspace_id,id,version,title,lead,lead_id,company_id,contact_id,opportunity_id,owner,priority,due,due_at,time,type,notes,status,reminder,recurrence,outcome,created_at,updated_at,completed_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,'',?,'15 minutes before','None',?,?,?,?)"),
};

remove();
db.exec('BEGIN');
const leads = [];
const names = new Set();
let activityCount = 0;
const log = (lead, type, detail, offset) => {
  activityCount += 1;
  const when = [clock(offset, workHour()), nowClock].sort()[0]; // Never later than now, or "today" shows a time that hasn't happened.
  insert.activity.run(uuid('a', activityCount), WORKSPACE, 8000000 + activityCount, lead.name, lead.id, lead.company, type, detail, when, lead.owner, when, utcStamp(offset), utcStamp(offset));
  if (!lead.touch || when > lead.touch) lead.touch = when;
};

plan.forEach(([status, closedDaysAgo], index) => {
  const [industry, kinds] = markets[index % markets.length];
  const city = cities[index % cities.length];
  // Company names must be unique, and this walks through the combinations without repeating.
  const name = `${places[(index + Math.floor(index / places.length)) % places.length]} ${kinds[Math.floor(index / markets.length) % kinds.length]}`;
  if (names.has(name)) throw new Error(`Duplicate sample company: ${name}`);
  names.add(name);
  const person = `${pick(firstNames)} ${pick(lastNames)}`;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
  const phone = `+63 917 555 ${String(1000 + index).slice(-4)}`;
  const email = `hello@${slug}.example`;
  const fromFinder = index % 3 === 0;
  const age = closedDaysAgo === undefined ? between(1, 70) : closedDaysAgo + between(12, 40);
  const seller = sellers[index % sellers.length];
  const lead = { id: uuid('b', index), company: uuid('c', index), contact: uuid('e', index), deal: uuid('f', index), name, owner: seller, status, phone, age };
  const priority = pick(['High', 'Medium', 'Medium', 'Low']);
  const service = services[index % services.length];
  const value = between(5, 90) * 5000;

  insert.company.run(lead.company, WORKSPACE, name, industry, city, phone, email, `https://${slug}.example`, 'not_found', fromFinder ? 'Google Places' : null, fromFinder ? `demo-place-${index}` : null, `${between(10, 240)} Gen. Maxilom Ave, ${city}`, seller, utcStamp(-age), utcStamp(-age));
  insert.contact.run(lead.contact, WORKSPACE, lead.company, person, 'Owner', email, phone);

  const newest = closedDaysAgo ?? Math.floor(random() * Math.min(age, 12));
  const touches = status === 'New' ? (index % 2 ? 1 : 0) : status === 'Contacted' ? between(1, 3) : between(3, 7);
  // A few open leads go quiet, so "No touch in 14+ days" has something to show.
  const coldLead = ['Contacted', 'Interested'].includes(status) && index % 4 === 0;
  for (let touch = 0; touch < touches; touch += 1) {
    const offset = -Math.min(age, (coldLead ? 16 : newest) + touch * between(2, 6));
    const roll = random();
    if (roll < 0.5) log(lead, 'Call', pick(callNotes), offset);
    else if (roll < 0.75) log(lead, 'Email', pick(emailNotes), offset);
    else if (roll < 0.9) log(lead, 'Note', pick(noteNotes), offset);
    else log(lead, 'Meeting', pick(meetingNotes), offset);
  }
  let proposalOffset = null;
  if (['Proposal', 'Negotiation', 'Won'].includes(status)) {
    proposalOffset = -Math.min(age - 1, (closedDaysAgo ?? 0) + between(1, 9));
    log(lead, 'Proposal', `${service} proposal · ₱${value.toLocaleString('en-US')}`, proposalOffset);
  }

  const closed = closedDaysAgo === undefined ? null : utcStamp(-closedDaysAgo, 4);
  insert.opportunity.run(lead.deal, WORKSPACE, lead.company, lead.id, lead.contact, `${service}`, status, value, probability[status], closedDaysAgo === undefined ? dayOf(between(5, 55)) : dayOf(-closedDaysAgo), seller, priority, status === 'Won' ? 'Signed after the proposal meeting' : status === 'Lost' ? 'Chose another provider' : null, utcStamp(-age), utcStamp(-newest), closed, proposalOffset === null ? null : utcStamp(proposalOffset));
  const nextStep = status === 'Won' ? 'Start onboarding · Not scheduled' : status === 'Lost' ? 'No next step · Closed' : status === 'New' ? 'Initial call · Not scheduled' : `${pick(['Call back', 'Send proposal', 'Follow up', 'Book a meeting'])} · ${shortDate(between(0, 6))}`;
  insert.lead.run(lead.id, WORKSPACE, lead.company, lead.contact, name, industry, city, status, between(38, 96), seller, '', nextStep, phone, email, person, priority, service, value, probability[status], dayOf(between(5, 55)), utcStamp(-age), utcStamp(-newest), utcStamp(-newest, between(1, 9)), lead.touch || null);
  leads.push(lead);
});

const open = leads.filter(lead => !['Won', 'Lost'].includes(lead.status));
let taskCount = 0;
const addTask = (lead, title, type, status, offset, time, ownerName = lead.owner, completedOffset = null) => {
  taskCount += 1;
  const due = status === 'Completed' ? shortDate(offset) : offset < 0 ? 'Overdue' : offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : shortDate(offset);
  insert.task.run(uuid('d', taskCount), WORKSPACE, 8800000 + taskCount, title, lead.name, lead.id, lead.company, lead.contact, null, ownerName, pick(['High', 'Medium', 'Medium', 'Low']), due, dayOf(offset), time, type, status, status === 'Completed' ? 'Done' : null, utcStamp(offset - 3), utcStamp(completedOffset ?? 0), completedOffset === null ? null : utcStamp(completedOffset, between(1, 9)));
};
const taskPlans = [['Call to confirm budget', 'Call'], ['Send pricing follow-up', 'Email'], ['Book a discovery meeting', 'Meeting'], ['Follow up on proposal', 'Follow-up'], ['Message on Facebook', 'Facebook message'], ['Prepare quote', 'Prepare quote']];
// Your own tasks first, so the Next follow-up tile has something real to show when you sign in.
['09:30', '11:00', '14:30'].forEach((time, index) => { const [title, type] = taskPlans[index]; addTask(open[index], title, type, 'Scheduled', 0, time, owner.name); });
['10:00', '10:30', '13:00', '13:30', '15:00', '16:00', '16:30'].forEach((time, index) => { const [title, type] = taskPlans[index % taskPlans.length]; addTask(open[(index + 3) % open.length], title, type, 'Scheduled', 0, time); });
[-1, -2, -3, -1].forEach((offset, index) => { const [title, type] = taskPlans[(index + 2) % taskPlans.length]; addTask(open[(index + 11) % open.length], title, type, 'Scheduled', offset, workHour()); });
for (let index = 0; index < 12; index += 1) { const [title, type] = taskPlans[index % taskPlans.length]; addTask(open[(index + 16) % open.length], title, type, 'Scheduled', between(1, 14), workHour()); }
for (let index = 0; index < 46; index += 1) { const [title, type] = taskPlans[index % taskPlans.length]; const daysAgo = index < 12 ? between(0, 4) : between(5, 80); addTask(leads[index % leads.length], title, type, 'Completed', -daysAgo, workHour(), leads[index % leads.length].owner, -daysAgo); }

const addSearch = (index, name, industry, location, status, found, kind) => {
  const id = uuid('9', index);
  db.prepare("INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,location,target_count,requirements_json,sales_focus,requirement_mode,provider,status,progress,stage,found_count,imported_count,saved,hidden_found_count,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,100,'[\"Phone\"]','Website & booking','any','Google Places',?,?,?,?,?,?,0,?,?,?)")
    .run(id, WORKSPACE, owner.id, name, industry, location, status, found ? 100 : 0, found ? 'Done' : 'Ready', found, 0, found ? 0 : 1, found ? utcStamp(-index) : null, utcStamp(-index), utcStamp(-index));
  for (let result = 0; result < found; result += 1) {
    const place = `${places[(result + index * 5) % places.length]} ${kind[result % kind.length]}`;
    const score = between(35, 94);
    db.prepare("INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,address,city,phone,email,website,source_url,business_status,rating,review_count,score,score_reason,opportunity,rule_score,rule_score_reason,ai_status,latitude,longitude,distance_km,facebook_status,fetched_at,verified_at) VALUES (?,?,?,'Google Places',?,?,?,?,'Cebu City',?,?,?,?,'OPERATIONAL',?,?,?,?,?,?,?,'skipped',?,?,?,'not_found',?,?)")
      .run(uuid('7', index * 100 + result), WORKSPACE, id, `demo-result-${index}-${result}`, place, industry, `${between(10, 240)} Osmeña Blvd, Cebu City`, `+63 932 555 ${String(2000 + result).slice(-4)}`, result % 3 ? '' : `info${result}@sample.example`, result % 4 ? '' : `https://result${result}.example`, 'https://www.google.com/maps', (35 + between(0, 14)) / 10, between(4, 310), score, 'No website, active on Google', 'Website and online booking', score, 'Good reviews with no website', 10.3157 + (random() - 0.5) * 0.12, 123.8854 + (random() - 0.5) * 0.12, between(1, 9), utcStamp(-index), utcStamp(-index));
  }
};
addSearch(1, 'Dental clinics in City of Cebu', 'Dental clinics', 'City of Cebu', 'Completed', 18, ['Dental Studio', 'Dental Care', 'Family Dentists']);
addSearch(2, 'Spas in Mandaue', 'Spas', 'Mandaue City', 'Completed', 14, ['Day Spa', 'Wellness Center']);
addSearch(3, 'Hotels in Lapu-Lapu', 'Hotels', 'Lapu-Lapu City', 'Saved', 0, []);

[['demo-andrea', 'andrea.santos'], ['demo-miguel', 'miguel.reyes'], ['demo-bianca', 'bianca.cruz'], ['demo-paolo', 'paolo.lim'], ['demo-carla', 'carla.mendoza']].forEach(([id, handle], index) => {
  const [, name, role, title] = reps[index];
  db.prepare("INSERT INTO users (id,email,name,job_title,status,last_seen_at) VALUES (?,?,?,?,'active',?)").run(id, `${handle}@example.com`, name, title, utcStamp(-index));
  db.prepare('INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES (?,?,?)').run(WORKSPACE, id, role);
});

[['A lead was assigned to you', `${open[0].name} is ready for a first call.`, '?page=leads'], ['Proposal follow-up due', `${open[1].name} is waiting on your proposal.`, '?page=tasks']].forEach(([title, body, link], index) => {
  db.prepare('INSERT INTO notifications (id,workspace_id,user_id,title,body,link) VALUES (?,?,?,?,?,?)').run(uuid('8', index), WORKSPACE, owner.id, title, body, link);
});
db.exec('COMMIT');

const count = table => db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total;
console.log(`Sample data added: ${count('leads')} leads, ${count('opportunities')} deals, ${count('tasks')} tasks, ${count('activities')} activities, ${count('finder_searches')} Finder searches, ${count('workspace_memberships')} team members.`);
console.log('Refresh Scout to see it. Remove it with: npm run demo:remove');
