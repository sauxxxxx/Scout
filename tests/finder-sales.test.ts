import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { contactChannel, facebookActivity, facebookResearchSchema, normalizeFacebookPageUrl, prospectScore, readiness, sameProspect, type SalesProspect } from '@/lib/finder-sales';
import { finderFacebookSchema, finderImportSchema } from '@/lib/validation';
import { existingFinderLeads, findDuplicate, importFinderResults } from '@/lib/finder-import';
import { saveFinderReview } from '@/lib/finder-review';
import { mapFinderResult, processFinderJob, processFinderMessage } from '@/lib/finder-store';
import { calibrateAssessment, type FinderAiInput, type FinderAiAssessment } from '@/lib/finder-ai';

const prospect: SalesProspect = {name:'Example Dental',city:'Cebu City',address:'One Main St',phone:'',email:'',website:'',socialUrl:'https://www.facebook.com/example',facebookStatus:'confirmed',score:85,ruleScore:85,facebookResearch:{pageName:'Example Dental',identityChecks:['name','location'],messenger:'available',websiteStatus:'not_found'}};
vi.mock('cloudflare:workers',()=>({env:{}}));
afterEach(()=>vi.unstubAllGlobals());
describe('Facebook sales evidence',()=>{
  it('preserves profile IDs and rejects share links, posts and foreign hosts as business pages',()=>{
    expect(normalizeFacebookPageUrl('https://m.facebook.com/profile.php?id=12345&ref=share')).toBe('https://www.facebook.com/profile.php?id=12345');
    for(const link of ['https://facebook.com/share/abc','https://facebook.com/example/posts/123','https://facebook.com/groups/example','https://facebook.com.evil.example/page','https://facebook.com/'])expect(normalizeFacebookPageUrl(link)).toBe('');
  });
  it('requires separate identity checks and a dated post source before calling activity recent',()=>{
    const now=Date.parse('2026-10-06T12:00:00Z');
    expect(facebookActivity(prospect,now)).toBe('unknown');
    const reviewed={...prospect,facebookResearch:{...prospect.facebookResearch!,lastPostAt:'2026-10-01',postUrl:'https://www.facebook.com/example/posts/123',reviewedAt:'2026-10-05T12:00:00Z'}};
    expect(facebookActivity(reviewed,now)).toBe('recent');
    expect(facebookActivity({...reviewed,facebookResearch:{...reviewed.facebookResearch,lastPostAt:'2026-08-01'}},now)).toBe('older');
    expect(facebookActivity({...reviewed,facebookStatus:'possible'},now)).toBe('unknown');
    expect(facebookResearchSchema.safeParse({identityChecks:['name','name']}).success).toBe(false);
    expect(facebookResearchSchema.safeParse({lastPostAt:'2026-01-01',postUrl:'https://facebook.com/example'}).success).toBe(false);
    expect(facebookResearchSchema.safeParse({lastPostAt:'2099-01-01',postUrl:'https://facebook.com/example/posts/123'}).success).toBe(false);
  });
  it('allows confirmed messaging-only prospects and does not treat stale AI as the active score',()=>{
    expect(contactChannel(prospect)).toBe('Facebook');
    expect(readiness(prospect,['Facebook'])).toBe('Ready for outreach');
    expect(readiness(prospect,['Facebook','Phone'])).toBe('Criteria need review');
    expect(readiness(prospect,['Facebook','Phone'],'any')).toBe('Ready for outreach');
    expect(contactChannel({...prospect,facebookStatus:'possible'})).toBe('Review');
    expect(prospectScore({...prospect,aiScore:99,aiStatus:'pending',ruleScore:62})).toBe(62);
    expect(readiness({...prospect,aiIcpMatch:'weak',aiStatus:'pending'},['Facebook'])).toBe('Ready for outreach');
    expect(sameProspect(prospect,{...prospect,address:'Two Main St'})).toBe(false);
  });
  it('does not cap an evidenced Facebook-only business for missing a phone',()=>{
    const input={...prospect,industry:'Dental',location:'Cebu',searchIndustry:'Dental',searchLocation:'Cebu',ruleScore:85,ruleReason:'Reviewed',websiteSummary:'',evidence:[]} as FinderAiInput;
    const assessment:FinderAiAssessment={classification:'Dental',icpMatch:'strong',fitScore:90,confidence:'high',explanation:'Public business details match.',opportunitySignals:[],concerns:[],recommendedNextAction:'Call them.',evidenceReferences:[]};
    const result=calibrateAssessment(input,assessment);
    expect(result.fitScore).toBeGreaterThan(64);
    expect(result.recommendedNextAction).toMatch(/Facebook/i);
  });
});

function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync('db/migrations').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(`db/migrations/${file}`,'utf8'));
  sql.exec("INSERT INTO users (id,email,name,status) VALUES ('user','tester@example.com','Tester','active'); INSERT INTO workspace_memberships (workspace_id,user_id,role) VALUES ('scout-default','user','owner')");
  const statement=(query:string,values:SQLInputValue[]=[])=>({bind:(...args:SQLInputValue[])=>statement(query,args),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:{changes:Number(sql.prepare(query).run(...values).changes)}})});
  const db={prepare:statement,batch:async(queries:ReturnType<typeof statement>[])=>{sql.exec('BEGIN');try{const results=[];for(const query of queries)results.push(await query.run());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}} as unknown as D1Database;
  const searchId=crypto.randomUUID();sql.prepare("INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,location,target_count,requirements_json,status) VALUES (?,'scout-default','user','Facebook dentists','Dental','Cebu City',10,'[\"Facebook\"]','Complete')").run(searchId);
  const add=(name='Example Dental',address='One Main St',record=crypto.randomUUID())=>{const id=crypto.randomUUID();sql.prepare("INSERT INTO finder_results (id,workspace_id,search_id,provider,provider_record_id,name,industry,city,address,source_url,score,score_reason,rule_score,opportunity,fetched_at,verified_at,facebook_status,social_url,ai_status) VALUES (?,'scout-default',?,'Google Places',?,?, 'Dental','Cebu City',?,'https://maps.google.com/',70,'Needs review',70,'Verify website presence',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'possible','https://www.facebook.com/example','skipped')").run(id,searchId,record,name,address);return id};
  const importInput=(ids:string[],extra={})=>finderImportSchema.parse({action:'import',searchId,resultIds:ids,ownerId:'user',assignmentMode:'single',priority:'Medium',status:'New',followUpDate:'2026-10-10',...extra});
  const reviewInput=(resultId:string,version=0)=>finderFacebookSchema.parse({action:'facebook',searchId,resultId,facebookUrl:'https://facebook.com/example',status:'confirmed',research:prospect.facebookResearch,reviewVersion:version});
  return{sql,db,searchId,add,importInput,reviewInput};
}
describe('Finder review and CRM handoff',()=>{
  it('discards an AI response that was started before a newer sales review',async()=>{
    const f=fixture();try{const id=f.add();f.sql.prepare("UPDATE finder_results SET ai_status='pending' WHERE id=?").run(id);
      let release!: (response:Response)=>void; let started!: ()=>void;
      const entered=new Promise<void>(resolve=>{started=resolve});
      vi.stubGlobal('fetch',vi.fn(()=>{started();return new Promise<Response>(resolve=>{release=resolve})}));
      const pending=processFinderMessage(f.db,{kind:'ai',workspaceId:'scout-default',searchId:f.searchId,resultId:id},{geminiApiKey:'test',geminiModel:'test'});
      await entered;await saveFinderReview(f.db,'scout-default','Tester',f.reviewInput(id));
      release(Response.json({candidates:[{content:{parts:[{text:JSON.stringify({classification:'Dental',icpMatch:'weak',fitScore:12,confidence:'low',explanation:'Old assessment.',opportunitySignals:[],concerns:[],recommendedNextAction:'Research.',evidenceReferences:[]})}]}}]}));await pending;
      const result=mapFinderResult(f.sql.prepare('SELECT * FROM finder_results WHERE id=?').get(id)!);expect(result.reviewVersion).toBe(1);expect(result.aiStatus).toBe('pending');expect(result.aiScore).toBeUndefined();expect(result.ruleScore).toBeGreaterThan(64);
    }finally{f.sql.close()}
  });
  it('rolls back the whole prospect handoff if creating its task fails',async()=>{
    const f=fixture();try{const id=f.add();f.sql.exec("CREATE TRIGGER reject_fixture_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'Test failure'); END");
      await expect(importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([id]))).rejects.toThrow('Test failure');
      for(const table of ['leads','companies','contacts','tasks','activities'])expect(f.sql.prepare(`SELECT COUNT(*) total FROM ${table}`).get()?.total).toBe(0);
      expect(f.sql.prepare('SELECT imported_lead_id FROM finder_results WHERE id=?').get(id)?.imported_lead_id).toBeNull();
    }finally{f.sql.close()}
  });
  it('imports a Facebook-only prospect with its research, message task and stable links, then skips a retry',async()=>{
    const f=fixture();try{const id=f.add();expect(await saveFinderReview(f.db,'scout-default','Tester',f.reviewInput(id))).toEqual({ok:true});
      const imported=await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([id]));expect(imported).toHaveProperty('imported');
      expect(f.sql.prepare('SELECT type FROM tasks').get()?.type).toBe('Facebook message');
      expect(f.sql.prepare('SELECT probability FROM opportunities').get()?.probability).toBe(10);
      expect(f.sql.prepare('SELECT opportunity_id FROM tasks').get()?.opportunity_id).toBeTruthy();
      expect(JSON.parse(String(f.sql.prepare('SELECT facebook_research_json FROM companies').get()?.facebook_research_json)).reviewedBy).toBe('Tester');
      expect(await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([id]))).toMatchObject({imported:[],skipped:1});
      expect(f.sql.prepare('SELECT COUNT(*) total FROM leads').get()?.total).toBe(1);
      f.sql.exec("UPDATE leads SET finder_provider=NULL,finder_record_id=NULL,business_address=''");
      const original=mapFinderResult(f.sql.prepare('SELECT * FROM finder_results WHERE id=?').get(id)!);
      expect(findDuplicate(original,await existingFinderLeads(f.db,'scout-default'))?.id).toBeTruthy();
    }finally{f.sql.close()}
  });
  it('creates research first, then updates the linked company and pending task after review without changing completed work',async()=>{
    const f=fixture();try{const id=f.add();await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([id]));
      expect(f.sql.prepare('SELECT type FROM tasks').get()?.type).toBe('Research');expect(f.sql.prepare('SELECT COUNT(*) total FROM opportunities').get()?.total).toBe(0);
      await saveFinderReview(f.db,'scout-default','Tester',f.reviewInput(id));expect(f.sql.prepare('SELECT type FROM tasks').get()?.type).toBe('Facebook message');expect(f.sql.prepare('SELECT next FROM leads').get()?.next).toMatch(/Facebook/);
      f.sql.exec("UPDATE tasks SET status='Completed'");await saveFinderReview(f.db,'scout-default','Tester',{...f.reviewInput(id,1),status:'possible'});expect(f.sql.prepare('SELECT status FROM tasks').get()?.status).toBe('Completed');
      expect(await saveFinderReview(f.db,'scout-default','Tester',f.reviewInput(id,0))).toMatchObject({status:409});
      expect(await saveFinderReview(f.db,'other','Tester',f.reviewInput(id,2))).toMatchObject({status:404});
    }finally{f.sql.close()}
  });
  it('requires a branch check for a shared name and imports separate source records safely',async()=>{
    const f=fixture();try{const a=f.add();await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([a]));const b=f.add('Example Dental','Two Main St');
      expect(await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([b]))).toMatchObject({status:409});
      await importFinderResults(f.db,'scout-default',{id:'user',name:'Tester',role:'owner'},f.importInput([b],{allowPossibleDuplicates:true}));expect(f.sql.prepare('SELECT COUNT(*) total FROM leads').get()?.total).toBe(2);expect(f.sql.prepare('SELECT COUNT(*) total FROM companies').get()?.total).toBe(2);
    }finally{f.sql.close()}
  });
  it('keeps manual confirmation and its corrected URL when Google is searched again',async()=>{
    const f=fixture();try{const id=f.add('Example Dental','One Main St','provider-id');await saveFinderReview(f.db,'scout-default','Tester',{...f.reviewInput(id),facebookUrl:'https://facebook.com/correctpage'});f.sql.prepare("UPDATE finder_searches SET status='Queued' WHERE id=?").run(f.searchId);
      vi.stubGlobal('fetch',vi.fn(async()=>Response.json({places:[{id:'provider-id',displayName:{text:'Example Dental'},formattedAddress:'One Main St',googleMapsUri:'https://maps.google.com/',businessStatus:'OPERATIONAL'}]})));
      await processFinderJob(f.db,'scout-default',f.searchId,{googlePlacesApiKey:'test',aiMaxCandidates:0});const result=mapFinderResult(f.sql.prepare('SELECT * FROM finder_results WHERE id=?').get(id)!);expect(result.facebookStatus).toBe('confirmed');expect(result.socialUrl).toBe('https://www.facebook.com/correctpage');expect(result.facebookResearch.messenger).toBe('available');
    }finally{f.sql.close()}
  });
});
