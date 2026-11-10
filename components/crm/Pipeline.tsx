'use client';
/* eslint-disable react-hooks/set-state-in-effect -- Scout coordinates persisted records, URL state, and floating UI through effects in this single client workspace. */

import { useEffect, useRef, useState } from 'react';
import { FiCalendar, FiCheck, FiChevronRight, FiColumns, FiFileText, FiFilter, FiList, FiPlus, FiSearch, FiSliders, FiX } from 'react-icons/fi';
import { formatDate } from '@/lib/format';
import { leadStatuses } from '@/lib/validation';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { profileDefaults, type ProfileUpdate } from '@/lib/profile';
import type { Company, Contact, Opportunity, Lead, ActivityEntry, TaskItem } from '@/lib/crm-types';
import { Avatar, EmptyState, Heading, CustomSelect, PriorityBadge, StatusField, useCrmData, useCustomization, EmailLink } from '@/components/crm/shared';

export function PipelineWorkspace({view,setView,opportunities,...props}:{view:string;setView:(view:string)=>void;opportunities:Opportunity[]} & Omit<Parameters<typeof OpportunityPipeline>[0],'opportunities'>) {
  const {currentMember}=useWorkspaceMembers();const {statusLabel}=useCustomization();
  if(view==='Archived'){const archived=opportunities.filter(item=>item.archived);return <><Heading title="Archived opportunities"/><div className="archived-list">{archived.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{statusLabel(item.stage)} · {item.owner}</span></div><button className="secondary" onClick={()=>props.onSave({...item,archived:false})}>Restore</button></article>)}{archived.length===0&&<p className="workflow-empty">Nothing is archived.</p>}</div></>}
  if(view!=='Forecast'){const scoped=view==='My pipeline'?opportunities.filter(item=>item.owner===currentMember?.name):opportunities;return <OpportunityPipeline {...props} opportunities={scoped}/>}
  const forecast=opportunities.filter(item=>!item.archived&&!['Won','Lost'].includes(item.stage)).sort((a,b)=>(a.closeDate||'9999').localeCompare(b.closeDate||'9999'));const total=forecast.reduce((sum,item)=>sum+item.value,0);const weighted=Math.round(forecast.reduce((sum,item)=>sum+item.value*item.probability/100,0));const month=(date?:string)=>{if(!date)return 'No close date';const parsed=new Date(`${date}T12:00:00`);return Number.isNaN(parsed.getTime())?'No close date':parsed.toLocaleDateString('en-US',{month:'long',year:'numeric'})};const groups=Array.from(new Set(forecast.map(item=>month(item.closeDate))));const money=(value:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:(props.preferences||profileDefaults).currency,maximumFractionDigits:0}).format(value);
  return <><Heading title="Forecast" action={<button className="secondary" onClick={()=>setView('All pipeline')}>View pipeline</button>}/><div className="pipeline-metrics"><div><span>Open value</span><strong>{money(total)}</strong></div><div><span>Weighted forecast</span><strong>{money(weighted)}</strong></div><div><span>Expected deals</span><strong>{forecast.length}</strong></div></div><div className="forecast-groups">{groups.map(group=>{const items=forecast.filter(item=>month(item.closeDate)===group);return <section key={group}><header><h2>{group}</h2><span>{money(items.reduce((sum,item)=>sum+item.value,0))}</span></header>{items.map(item=>{const company=props.companies.find(value=>value.id===item.companyId);const lead=props.leads.find(value=>value.id===item.leadId);return <article key={item.id}><div><strong>{item.name}</strong><span>{company?.name||'Unknown company'}</span></div><span>{statusLabel(item.stage)}</span><span>{item.probability}%</span><strong>{money(item.value)}</strong><button disabled={!lead} onClick={()=>lead&&props.openLead(lead.name)}>Open<FiChevronRight/></button></article>})}</section>})}</div></>;
}

export function OpportunityPipeline({opportunities,companies,contacts,leads,tasks,activities,onCreate,onSave,notify,openLead,focusedOpportunity,setFocusedOpportunity,preferences=profileDefaults}:{opportunities:Opportunity[];companies:Company[];contacts:Contact[];leads:Lead[];tasks:TaskItem[];activities:ActivityEntry[];onCreate:(opportunity:Omit<Opportunity,'id'|'version'>)=>Promise<Opportunity|null>;onSave:(opportunity:Opportunity)=>Promise<boolean>;notify:(message:string)=>void;openLead:(name:string)=>void;focusedOpportunity:string|null;setFocusedOpportunity:(value:string|null)=>void;preferences?:ProfileUpdate['preferences']}){
  const {currentMember,defaultOwner:preferredOwner}=useWorkspaceMembers();const {statusLabel}=useCustomization();
  const defaultOwner=preferredOwner?.name||currentMember?.name||'';
  const stages:string[]=[...leadStatuses];
  const probabilities:Record<string,number>={New:10,Contacted:25,Interested:40,'Follow-up':50,Proposal:60,Negotiation:80,Won:100,Lost:0};
  const [mode,setMode]=useState<'Board'|'Detailed'|'Table'>(preferences.pipelineView);
  const [owner,setOwner]=useState('All owners');
  const [priority,setPriority]=useState('All priorities');
  const [query,setQuery]=useState('');
  const [showFilters,setShowFilters]=useState(false);
  const [expandedStages,setExpandedStages]=useState<string[]>([]);
  const {undoable}=useCrmData();
  const [showProperties,setShowProperties]=useState(false);
  const [sortBy,setSortBy]=useState('Sort: Default');
  const [cardProperties,setCardProperties]=useState(preferences.cardProperties);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [draft,setDraft]=useState<Opportunity|null>(null);
  const [creating,setCreating]=useState(false);
  const [pending,setPending]=useState<{opportunity:Opportunity;stage:string}|null>(null);
  const [reason,setReason]=useState('');
  const [form,setForm]=useState({companyId:companies[0]?.id||'',name:'',stage:'New',value:'',probability:'20',closeDate:'',owner:defaultOwner,priority:'Medium'});
  const lastDragEnd=useRef(0);
  const boardRef=useRef<HTMLDivElement|null>(null);
  const [draggedId,setDraggedId]=useState<string|null>(null);
  const [justWon,setJustWon]=useState<string|null>(null);
  const [dragOverStage,setDragOverStage]=useState<string|null>(null);
  const money=(value:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:preferences.currency,maximumFractionDigits:0}).format(value);

  useEffect(()=>{setMode(preferences.pipelineView);setCardProperties(preferences.cardProperties)},[preferences]);
  useEffect(()=>{if(!form.companyId&&companies[0])setForm(value=>({...value,companyId:companies[0].id}))},[companies,form.companyId]);
  useEffect(()=>{if(!focusedOpportunity)return;const match=opportunities.find(item=>item.id===focusedOpportunity||item.name===focusedOpportunity||leads.find(lead=>lead.id===item.leadId)?.name===focusedOpportunity);if(match)setSelectedId(match.id);setFocusedOpportunity(null)},[focusedOpportunity,opportunities,leads,setFocusedOpportunity]);
  useEffect(()=>{if(mode==='Table'||!boardRef.current)return;const board=boardRef.current;board.scrollLeft=0;const frame=window.requestAnimationFrame(()=>{board.scrollLeft=0});return()=>window.cancelAnimationFrame(frame)},[mode]);
  const selected=opportunities.find(item=>item.id===selectedId)||null;
  useEffect(()=>{setDraft(selected?{...selected}:null)},[selected?.id,selected?.version]);

  const companyName=(id:string)=>companies.find(company=>company.id===id)?.name||'Unknown company';
  const ownerOptions=['All owners',...Array.from(new Set(opportunities.map(item=>item.owner).filter(Boolean))).sort()];
  const leadFor=(item:Opportunity)=>leads.find(lead=>lead.id===item.leadId);
  const contactFor=(item:Opportunity)=>contacts.find(contact=>contact.id===item.primaryContactId)||contacts.find(contact=>contact.companyId===item.companyId&&contact.isPrimary);
  const nextTaskFor=(item:Opportunity)=>tasks.find(task=>task.opportunityId===item.id&&task.status!=='Completed')||tasks.find(task=>task.leadId===item.leadId&&task.status!=='Completed');
  const visible=opportunities.filter(item=>!item.archived&&(owner==='All owners'||item.owner===owner)&&(priority==='All priorities'||item.priority===priority)&&`${item.name} ${companyName(item.companyId)} ${item.owner}`.toLowerCase().includes(query.toLowerCase())).sort((left,right)=>sortBy==='Sort: Name'?left.name.localeCompare(right.name):sortBy==='Sort: Value'?right.value-left.value:sortBy==='Sort: Close date'?(left.closeDate||'9999').localeCompare(right.closeDate||'9999'):0);
  const move=async(opportunity:Opportunity,stage:string)=>{
    if(stage===opportunity.stage)return;
    if(['Won','Lost'].includes(stage)){setPending({opportunity,stage});return}
    const saved=await onSave({...opportunity,stage,probability:probabilities[stage]??opportunity.probability});
    if(saved)notify(`Opportunity moved to ${statusLabel(stage)}`);
  };
  const confirmMove=async()=>{
    if(!pending)return;
    const saved=await onSave({...pending.opportunity,stage:pending.stage,probability:probabilities[pending.stage],outcome:reason||undefined});
    if(!saved)return;
    if(pending.stage==='Won'){setSelectedId(null);setExpandedStages(value=>value.includes('Won')?value:[...value,'Won']);setJustWon(pending.opportunity.id);window.setTimeout(()=>setJustWon(null),2000);notify(`Deal won: ${pending.opportunity.name}, ${money(pending.opportunity.value)}`)}else notify(`Opportunity marked ${statusLabel(pending.stage)}`);
    setPending(null);
    setReason('');
  };
  const create=async()=>{
    if(!form.companyId||!form.name.trim())return;
    const lead=leads.find(item=>item.companyId===form.companyId);
    const primary=contacts.find(contact=>contact.companyId===form.companyId&&contact.isPrimary);
    const created=await onCreate({companyId:form.companyId,leadId:lead?.id,primaryContactId:primary?.id,name:form.name.trim(),stage:form.stage,value:Number(form.value)||0,probability:Number(form.probability)||probabilities[form.stage],closeDate:form.closeDate||undefined,owner:form.owner,priority:form.priority,archived:false});
    if(!created)return;
    setCreating(false);
    setForm({companyId:companies[0]?.id||'',name:'',stage:'New',value:'',probability:'20',closeDate:'',owner:defaultOwner,priority:'Medium'});
    notify('Opportunity created');
  };
  const saveDraft=async()=>{if(!draft)return;const saved=await onSave(draft);if(saved){setSelectedId(null);notify('Opportunity saved')}};
  const beginCreate=(stage='New')=>{setForm(value=>({...value,stage,probability:String(probabilities[stage]??20)}));setCreating(true)};

  const isCollapsed=(stage:string)=>mode==='Board'&&['Won','Lost'].includes(stage)&&!expandedStages.includes(stage);
  const board=<div ref={boardRef} className={`pipeline-board-modern ${mode==='Detailed'?'detailed':'compact'}`} style={mode==='Board'?{gridTemplateColumns:stages.map(stage=>isCollapsed(stage)?'calc(96px*var(--font-scale))':'minmax(calc(170px*var(--font-scale)),1fr)').join(' ')}:undefined}>{stages.map((stage,index)=>{
    const stageItems=visible.filter(item=>item.stage===stage);
    const collapsed=isCollapsed(stage);
    return <section className={`pipeline-column pipeline-column-${index} ${collapsed?'is-collapsed':''} ${dragOverStage===stage?'drag-over':''}`} onDragEnter={()=>setDragOverStage(stage)} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragOverStage(null)}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move'}} onDrop={event=>{event.preventDefault();const item=opportunities.find(value=>value.id===event.dataTransfer.getData('text/plain'));setDragOverStage(null);if(item)move(item,stage)}} key={stage}>
      <header><div><span><i/>{statusLabel(stage)}</span><b>{stageItems.length}</b><button className="pipeline-column-add" aria-label={`Add opportunity to ${statusLabel(stage)}`} title="Add opportunity" onClick={()=>beginCreate(stage)}><FiPlus/></button></div></header>
      {collapsed?<button className="pipeline-expand" aria-label={`Show ${statusLabel(stage)} opportunities`} onClick={()=>setExpandedStages(value=>[...value,stage])}><strong>{money(stageItems.reduce((sum,item)=>sum+item.value,0))}</strong><small>Show</small></button>:<div className="pipeline-column-scroll">{stageItems.map(item=>{
        const lead=leadFor(item);const contact=contactFor(item);const nextTask=nextTaskFor(item);
        return <article className={`${draggedId===item.id?'dragging':''}${justWon===item.id?' just-won':''}`} draggable onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);setDraggedId(item.id)}} onDragEnd={()=>{lastDragEnd.current=Date.now();setDraggedId(null);setDragOverStage(null)}} onClick={()=>{if(Date.now()-lastDragEnd.current>250)setSelectedId(item.id)}} key={item.id}>
          <div className="pipeline-card-head"><strong>{item.name}</strong>{mode==='Detailed'&&cardProperties.value&&<b>{money(item.value)}</b>}</div>
          <p>{companyName(item.companyId)}</p>
          {mode==='Board'&&<div className="pipeline-card-compact">
            {cardProperties.value?<b className="pipeline-value">{money(item.value)}</b>:<span/>}
            {cardProperties.owner&&<span title={item.owner}><Avatar name={item.owner}/></span>}
            {(cardProperties.closeDate||cardProperties.probability||cardProperties.priority)&&<div className="pipeline-card-meta">
              {cardProperties.closeDate&&<span className="pipeline-close"><FiCalendar/>{item.closeDate?formatDate(item.closeDate):'No date'}</span>}
              {cardProperties.probability&&<span className="pipeline-probability">{item.probability}%</span>}
              {cardProperties.priority&&<PriorityBadge priority={item.priority} compact/>}
            </div>}
            {cardProperties.nextAction&&<span className="pipeline-next-action">{nextTask?.title||lead?.next?.split(' · ')[0]||'No next action'}</span>}
          </div>}
          {mode==='Detailed'&&<div className="pipeline-card-details">
            <span><small>Contact</small><strong>{contact?.name||lead?.contact||'Not assigned'}</strong></span>
            {cardProperties.owner&&<span><small>Owner</small><strong>{item.owner}</strong></span>}
            {cardProperties.closeDate&&<span><small>Close date</small><strong>{item.closeDate||'Not set'}</strong></span>}
            {cardProperties.priority&&<span><small>Priority</small><strong>{item.priority}</strong></span>}
            {cardProperties.nextAction&&<span className="pipeline-next"><small>Next action</small><strong>{nextTask?.title||lead?.next?.split(' · ')[0]||'None scheduled'}</strong></span>}
          </div>}
          {mode==='Detailed'&&<div className="pipeline-card-foot" onClick={event=>event.stopPropagation()}><span>{cardProperties.probability?`${item.probability}% probability`:''}</span><StatusField value={item.stage} options={stages} onChange={next=>move(item,next)}/></div>}
        </article>
      })}</div>}
    </section>
  })}</div>;

  return <><header className="pipeline-page-head"><h1>Pipeline</h1>
    <div className="pipeline-view-toolbar">
      <nav><button className={mode==='Board'?'active':''} onClick={()=>setMode('Board')}><FiColumns/>Board</button><button className={mode==='Detailed'?'active':''} onClick={()=>setMode('Detailed')}><FiFileText/>Detailed</button><button className={mode==='Table'?'active':''} onClick={()=>setMode('Table')}><FiList/>Table</button></nav>
      <div className="pipeline-toolbar-actions"><label><FiSearch/><input aria-label="Search pipeline" placeholder="Search" value={query} onChange={event=>setQuery(event.target.value)}/></label><button className={showFilters||owner!=='All owners'||priority!=='All priorities'?'active':''} onClick={()=>setShowFilters(value=>!value)}><FiFilter/>Filter</button><CustomSelect value={sortBy} options={['Sort: Default','Sort: Name','Sort: Value','Sort: Close date']} onChange={setSortBy}/><div className="pipeline-properties"><button className={showProperties?'active':''} onClick={()=>setShowProperties(value=>!value)}><FiSliders/>Properties</button>{showProperties&&<div className="pipeline-properties-menu">{([{key:'value',label:'Value'},{key:'owner',label:'Owner'},{key:'closeDate',label:'Close date'},{key:'probability',label:'Probability'},{key:'priority',label:'Priority'},{key:'nextAction',label:'Next action'}] as const).map(property=><button onClick={()=>setCardProperties(value=>({...value,[property.key]:!value[property.key]}))} key={property.key}><span>{property.label}</span>{cardProperties[property.key]&&<FiCheck/>}</button>)}</div>}</div></div>
    </div>
    <button className="primary" onClick={()=>beginCreate()}><FiPlus/> Add opportunity</button></header>
    {showFilters&&<div className="pipeline-filter-panel"><CustomSelect value={owner} options={ownerOptions} onChange={setOwner}/><CustomSelect value={priority} options={['All priorities','High','Medium','Low']} onChange={setPriority}/><button onClick={()=>{setOwner('All owners');setPriority('All priorities')}}>Clear filters</button></div>}
    {!opportunities.some(item=>!item.archived)?<EmptyState title="No opportunities yet" action={<button className="primary" onClick={()=>beginCreate()}><FiPlus/> Add opportunity</button>}>Opportunities track the deals you&apos;re working on, from first contact to won.</EmptyState>:mode==='Table'?<div className="pipeline-table-view"><div className="pipeline-table-head"><span>Opportunity</span><span>Stage</span><span>Value</span><span>Probability</span><span>Owner</span><span>Close date</span><span/></div>{visible.map(item=><div className="pipeline-table-row" key={item.id} onClick={()=>setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{companyName(item.companyId)}</small></span><span onClick={event=>event.stopPropagation()}><StatusField value={item.stage} options={stages} onChange={stage=>move(item,stage)}/></span><strong>{money(item.value)}</strong><span>{item.probability}%</span><span>{item.owner}</span><span>{item.closeDate||'Not set'}</span><FiChevronRight/></div>)}</div>:board}

    {selected&&draft&&<div className="drawer-backdrop" onClick={()=>setSelectedId(null)}><aside className="lead-drawer opportunity-drawer" onClick={event=>event.stopPropagation()}><header className="drawer-header"><div><h2>{selected.name}</h2><p>{companyName(selected.companyId)}</p></div><button onClick={()=>setSelectedId(null)} aria-label="Close"><FiX/></button></header><div className="detail-status"><div><span>Stage</span><StatusField value={selected.stage} options={stages} onChange={stage=>move(selected,stage)}/></div><div><span>Owner</span><CustomSelect value={draft.owner} options={ownerOptions.filter(value=>value!=='All owners')} onChange={owner=>setDraft({...draft,owner})}/></div><div><span>Probability</span><strong>{draft.probability}%</strong></div></div><section className="drawer-section opportunity-fields"><h3>Opportunity details</h3><label className="required"><span className="required-mark">Name</span><input aria-required="true" value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><div className="form-split"><label>Value<input type="number" min="0" value={draft.value} onChange={event=>setDraft({...draft,value:Number(event.target.value)})}/></label><label>Probability<input type="number" min="0" max="100" value={draft.probability} onChange={event=>setDraft({...draft,probability:Number(event.target.value)})}/></label></div><div className="form-split"><label>Expected close<input type="date" value={draft.closeDate||''} onChange={event=>setDraft({...draft,closeDate:event.target.value})}/></label><label>Priority<CustomSelect value={draft.priority} options={['Low','Medium','High']} onChange={priority=>setDraft({...draft,priority})}/></label></div></section><section className="drawer-section"><h3>Primary contact</h3>{contactFor(selected)?<p className="opportunity-contact"><strong>{contactFor(selected)?.name}</strong><span>{contactFor(selected)?.email?<EmailLink email={contactFor(selected)!.email}/>:contactFor(selected)?.phone}</span></p>:<p className="activity-readonly">No primary contact assigned.</p>}</section><section className="drawer-section"><h3>Open tasks</h3>{tasks.filter(task=>task.opportunityId===selected.id&&task.status!=='Completed').map(task=><div className="opportunity-task" key={task.id}><strong>{task.title}</strong><span>{task.due} · {task.owner}</span></div>)}{!tasks.some(task=>task.opportunityId===selected.id&&task.status!=='Completed')&&<p className="activity-readonly">No open tasks.</p>}</section><section className="drawer-section lead-activity"><h3>Recent activity</h3>{activities.filter(activity=>activity.opportunityId===selected.id||activity.leadId===selected.leadId).slice(0,4).map(activity=><article key={activity.uid||activity.id}><i/><div><strong>{activity.type}</strong><p>{activity.detail}</p><small>{activity.time} · {activity.owner}</small></div></article>)}</section><div className="close-actions">{selected.leadId&&<button onClick={()=>{const lead=leadFor(selected);if(lead)openLead(lead.name)}}>Open lead</button>}<button onClick={()=>{const item=selected;onSave({...item,archived:true});setSelectedId(null);undoable(`${item.name} archived`,()=>onSave({...item,version:item.version+1,archived:false}))}}>Archive</button><button className="primary" onClick={saveDraft}>Save changes</button></div></aside></div>}

    {creating&&<div className="action-modal-backdrop" onClick={()=>setCreating(false)}><div className="action-modal" onClick={event=>event.stopPropagation()}><header><h2>Add opportunity</h2><button onClick={()=>setCreating(false)} aria-label="Close"><FiX/></button></header><div className="action-modal-body"><label>Company<CustomSelect value={companyName(form.companyId)} options={companies.filter(company=>!company.archived).map(company=>company.name)} onChange={name=>setForm({...form,companyId:companies.find(company=>company.name===name)?.id||''})}/></label><label className="required"><span className="required-mark">Opportunity name</span><input aria-required="true" value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label><div className="form-split"><label>Stage<CustomSelect value={form.stage} options={stages.slice(0,6)} onChange={stage=>setForm({...form,stage,probability:String(probabilities[stage])})}/></label><label>Probability<input type="number" min="0" max="100" value={form.probability} onChange={event=>setForm({...form,probability:event.target.value})}/></label></div><div className="form-split"><label>Value<input type="number" min="0" value={form.value} onChange={event=>setForm({...form,value:event.target.value})}/></label><label>Expected close<input type="date" value={form.closeDate} onChange={event=>setForm({...form,closeDate:event.target.value})}/></label></div><div className="form-split"><label>Owner<CustomSelect value={form.owner} options={ownerOptions.filter(value=>value!=='All owners')} onChange={owner=>setForm({...form,owner})}/></label><label>Priority<CustomSelect value={form.priority} options={['Low','Medium','High']} onChange={priority=>setForm({...form,priority})}/></label></div></div><footer><button onClick={()=>setCreating(false)}>Cancel</button><button className="primary" disabled={!form.companyId||!form.name.trim()} onClick={create}>Create opportunity</button></footer></div></div>}

    {pending&&<div className="action-modal-backdrop"><div className="action-modal"><header><h2>Mark opportunity {statusLabel(pending.stage)}?</h2><button onClick={()=>setPending(null)} aria-label="Close"><FiX/></button></header><div className="action-modal-body"><div className="status-transition"><span>{statusLabel(pending.opportunity.stage)}</span><FiChevronRight/><strong>{statusLabel(pending.stage)}</strong></div><p>This also updates the linked lead status.</p><label>{pending.stage==='Won'?'Outcome':'Reason'}<textarea value={reason} onChange={event=>setReason(event.target.value)} placeholder={pending.stage==='Won'?'Add the result or deal details…':'Why was this opportunity lost?'}/></label></div><footer><button onClick={()=>setPending(null)}>Cancel</button><button className="primary" onClick={confirmMove}>Confirm</button></footer></div></div>}
  </>;
}

