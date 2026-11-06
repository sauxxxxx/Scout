'use client';

import { useLayoutEffect, useMemo, useRef, useState, createContext, useCallback, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiChevronDown, FiFlag } from 'react-icons/fi';
import { defaultCustomization, statusLabelOf, type Customization } from '@/lib/customization';
import { defaultViewSettings, type ViewSettings } from '@/lib/view-settings';
import { localIso } from '@/lib/task-dates';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { gmailComposeUrl } from '@/lib/gmail';
import type { Page, TaskItem, FloatingMenuPosition } from '@/lib/crm-types';

export const routePages:Page[]=['Overview','Leads','Finder','Pipeline','Tasks','Activities','Reports','Profile','Settings'];

export const routeViews:Partial<Record<Page,string[]>>={Settings:['Team','Access','Workspace','Branding','Sales setup','Roles','Activity log'],Leads:['Leads','Companies','Contacts','Assigned to me','Recently added','High priority','Archived'],Finder:['New search','Search history','Saved searches'],Pipeline:['All pipeline','My pipeline','Forecast','Archived'],Tasks:['Today','Upcoming','Overdue','Completed'],Activities:['All activity','Calls','Notes','Proposals'],Profile:['Profile','Preferences','Notifications','Security']};

export function initialsOf(name:string){return name.trim().split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase()}

export const sameItem=(left:unknown,right:unknown)=>sameRecord(left as Record<string,unknown>,right as Record<string,unknown>);

export function sameRecord(left:Record<string,unknown>,right:Record<string,unknown>){const clean=(value:Record<string,unknown>)=>{const copy={...value};delete copy.version;return copy};return JSON.stringify(clean(left))===JSON.stringify(clean(right))}

export function taskCalendarHref(task:TaskItem){const now=new Date();let day=task.dueAt;if(!day){const date=new Date(now);if(task.due==='Tomorrow')date.setDate(date.getDate()+1);else if(!['Today','Overdue'].includes(task.due)){const parsed=new Date(`${task.due}, ${now.getFullYear()}`);if(!Number.isNaN(parsed.getTime()))date.setTime(parsed.getTime())}day=localIso(date)}const start=new Date(`${day}T${task.time||'09:00'}:00`);const end=new Date(start.getTime()+30*60000);const stamp=(value:Date)=>value.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const escape=(value:string)=>value.replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Scout CRM//Tasks//EN','BEGIN:VEVENT',`UID:${task.uid||task.id}@scoutcrm`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${escape(task.title)}`,`DESCRIPTION:${escape(`${task.lead}${task.notes?` — ${task.notes}`:''}`)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}

// Production starts empty. Sample CRM records must never be persisted as real workspace data.

export function Heading({ title, action }:{title:string;action?:React.ReactNode}) {
  return <div className="page-head"><h1>{title}</h1>{action}</div>
}

export function useFloatingMenu(open:boolean,trigger:React.RefObject<HTMLButtonElement|null>,options:string[]) {
  const [position,setPosition]=useState<FloatingMenuPosition|null>(null);
  const optionCount=options.length;
  const longestOption=options.reduce((length,option)=>Math.max(length,option.length),0);
  useLayoutEffect(()=>{
    if(!open)return;
    const update=()=>{const element=trigger.current;if(!element)return;const rect=element.getBoundingClientRect();const margin=8;const gap=4;const naturalHeight=Math.min(optionCount*32+12,292);const below=Math.max(0,window.innerHeight-rect.bottom-margin-gap);const above=Math.max(0,rect.top-margin-gap);const placement:FloatingMenuPosition['placement']=below<naturalHeight&&above>below?'up':'down';const available=placement==='up'?above:below;const width=Math.max(rect.width,Math.min(220,longestOption*7+46));const left=Math.max(margin,Math.min(rect.left,window.innerWidth-width-margin));setPosition({top:placement==='down'?rect.bottom+gap:undefined,bottom:placement==='up'?window.innerHeight-rect.top+gap:undefined,left,width,maxHeight:Math.max(32,Math.min(naturalHeight,available)),placement})};
    update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)}
  },[open,optionCount,longestOption,trigger]);
  return position;
}

export function CustomSelect({value,options:allOptions,onChange,placeholder,label,onSearch,display=(option:string)=>option}:{value:string;options:string[];onChange:(value:string)=>void;placeholder?:string;label?:string;onSearch?:(query:string)=>void;display?:(option:string)=>string}) {
  const [search,setSearch]=useState('');const options=search?allOptions.filter(option=>option.toLowerCase().includes(search.toLowerCase())):allOptions;
  useEffect(()=>{if(!onSearch||search.trim().length<2)return;const timer=window.setTimeout(()=>onSearch(search.trim()),250);return()=>window.clearTimeout(timer)},[search,onSearch]);
  const [open,setOpen]=useState(false); const [active,setActive]=useState(Math.max(0,options.indexOf(value))); const trigger=useRef<HTMLButtonElement>(null); const position=useFloatingMenu(open,trigger,options);
  const choose=(option:string)=>{onChange(option);setOpen(false)};
  const keys=(e:React.KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(options.length-1,i+1))}if(e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>Math.max(0,i-1))}if(e.key==='Enter'&&open){e.preventDefault();choose(options[active])}};
  const menu=open&&position&&<div className={`select-menu floating-select-menu placement-${position.placement}`} style={{top:position.top,bottom:position.bottom,left:position.left,width:position.width,maxHeight:position.maxHeight}} role="listbox" onMouseDown={e=>{if((e.target as Element).tagName!=='INPUT')e.preventDefault()}}>{onSearch&&<input className="select-search" autoFocus placeholder="Search…" aria-label="Search options" value={search} onChange={event=>{setSearch(event.target.value);setActive(0)}}/>}{options.map((option,i)=><button type="button" role="option" aria-selected={option===value} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>choose(option)} key={option}><span>{display(option)}</span>{option===value&&<FiCheck/>}</button>)}</div>;
  return <div className="custom-select" onKeyDown={keys} onBlur={e=>!e.currentTarget.contains(e.relatedTarget)&&!(e.relatedTarget as Element|null)?.closest?.('.floating-select-menu')&&setOpen(false)}>{label&&<span className="select-label">{label}</span>}<button ref={trigger} type="button" className="select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span>{value?display(value):placeholder||'Select'}</span><FiChevronDown/></button>{menu&&createPortal(menu,document.body)}</div>
}

/** The status filter and pickers: `options` are the stored names, and people see the workspace's own. */
export function StatusField({value,options,onChange,placeholder,label}:{value:string;options:readonly string[];onChange:(value:string)=>void;placeholder?:string;label?:string}){
  const {statusLabel}=useCustomization();
  return <CustomSelect value={value} options={[...options]} onChange={onChange} placeholder={placeholder} label={label} display={statusLabel}/>;
}

export function OwnerSelect({value,onChange,allLabel,placeholder}:{value:string;onChange:(value:string)=>void;allLabel?:string;placeholder?:string}) {
  const names=useWorkspaceMembers().assignableMembers.map(member=>member.name);
  const options=[...(allLabel?[allLabel]:[]),...names,...(!allLabel&&value&&!names.includes(value)?[value]:[])];
  return <CustomSelect value={value} options={options} onChange={onChange} placeholder={placeholder}/>
}

export function StatusSelect({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const {statusLabel}=useCustomization();const [open,setOpen]=useState(false); const options=useMemo(()=>['New','Contacted','Interested','Follow-up','Proposal','Negotiation','Won','Lost'],[]); const trigger=useRef<HTMLButtonElement>(null); const position=useFloatingMenu(open,trigger,options); const statusClass=(name:string)=>name.toLowerCase().replace('-','');
  const menu=open&&position&&<div className={`select-menu status-menu floating-select-menu placement-${position.placement}`} style={{top:position.top,bottom:position.bottom,left:position.left,width:position.width,maxHeight:position.maxHeight}} role="listbox" onMouseDown={e=>e.preventDefault()}>{options.map(option=><button type="button" role="option" aria-selected={option===value} onClick={()=>{onChange(option);setOpen(false)}} key={option}><span><i className={`status-dot ${statusClass(option)}`}/>{statusLabel(option)}</span>{option===value&&<FiCheck/>}</button>)}</div>;
  return <div className="row-status-select" onClick={e=>e.stopPropagation()} onBlur={e=>!e.currentTarget.contains(e.relatedTarget)&&setOpen(false)}><button ref={trigger} type="button" className={`row-status-trigger status-pill ${statusClass(value)}`} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span>{statusLabel(value)}</span><FiChevronDown/></button>{menu&&createPortal(menu,document.body)}</div>
}

type LeadPage={total:number;stats?:{active:number;attention:number;proposals:number};industries?:string[]};
export type CrmData={
  loadLeads:(params:Record<string,string>)=>Promise<LeadPage|null>;
  searchLeads:(query:string)=>void;
  loadCompanies:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadContacts:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadCompletedTasks:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadHistory:(filter:{leadId?:string;companyId?:string})=>void;
  undoable:(message:string,undo:()=>void)=>void;
};
const nothing=async()=>null;
/** The workspace's own colours, names and task types. Falls back to Scout's defaults outside a workspace. */
const statusLabelFrom=(customization:Customization)=>(status:string)=>statusLabelOf(customization,status);
export const CustomizationContext=createContext<Customization>(defaultCustomization);
export function useCustomization(){const customization=useContext(CustomizationContext);return useMemo(()=>({customization,statusLabel:statusLabelFrom(customization),taskTypes:customization.taskTypes}),[customization])}

/** Layout choices that follow a person between devices. Saved as they're made. */
export const ViewSettingsContext=createContext<{view:ViewSettings;updateView:(patch:Partial<ViewSettings>)=>void}>({view:defaultViewSettings,updateView:()=>{}});
export const useViewSettings=()=>useContext(ViewSettingsContext);

export const CrmDataContext=createContext<CrmData>({loadLeads:nothing,searchLeads:()=>{},loadCompanies:nothing,loadContacts:nothing,loadCompletedTasks:nothing,loadHistory:()=>{},undoable:()=>{}});
export const useCrmData=()=>useContext(CrmDataContext);

const PAGE_FRESH_MS=30000;
const recentPages=new Map<string,{result:unknown;at:number}>();

/** Asks the server for matching records as filters change. Results join the local cache, and the screen's own filtering shows them. */
export function useServerPages<R extends {total:number}>(load:(params:Record<string,string>)=>Promise<R|null>,params:Record<string,string>,pageSize=100){
  const key=JSON.stringify(params);const [loaded,setLoaded]=useState<R|null>(null);const [paging,setPaging]=useState({key,page:1});
  const page=paging.key===key?paging.page:1;const result=(recentPages.get(key)?.result as R|undefined)??loaded;
  // Coming back to a screen shows what was there straight away. It only asks the server again once that's over 30 seconds old.
  useEffect(()=>{const cached=recentPages.get(key);if(cached&&Date.now()-cached.at<PAGE_FRESH_MS)return;let active=true;const timer=window.setTimeout(()=>{load({...JSON.parse(key) as Record<string,string>,page:'1',pageSize:String(pageSize)}).then(value=>{if(value)recentPages.set(key,{result:value,at:Date.now()});if(active){setLoaded(value);setPaging({key,page:1})}}).catch(()=>{})},cached?0:250);return()=>{active=false;window.clearTimeout(timer)}},[key,load,pageSize]);
  const more=()=>{const next=page+1;setPaging({key,page:next});load({...JSON.parse(key) as Record<string,string>,page:String(next),pageSize:String(pageSize)}).catch(()=>{})};
  return {result,total:result?.total??null,hasMore:!!result&&page*pageSize<result.total,more};
}

/** Re-renders on a timer so "5 min ago" keeps counting while a screen stays open. */
export function useNow(intervalMs=30000){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),intervalMs);return()=>window.clearInterval(timer)},[intervalMs]);
  return now;
}

/** Opens Gmail with the address filled in. Phones keep the normal mail link, because Gmail's web compose page is unreliable there. */
export function EmailLink({email,className,children}:{email:string;className?:string;children?:React.ReactNode}){
  const {currentMember}=useWorkspaceMembers();
  return <a className={className} href={gmailComposeUrl(email,currentMember?.email)} target="_blank" rel="noreferrer" onClick={event=>{event.stopPropagation();if(window.matchMedia('(pointer:coarse)').matches){event.preventDefault();window.location.href=`mailto:${email}`}}}>{children||email}</a>;
}

export function ScoutLogo({className='',logoUrl}:{className?:string;logoUrl?:string}){
  if(logoUrl)return <span className={`scout-logo custom-logo ${className}`}><img src={logoUrl} alt=""/></span>;
  return <span className={`scout-logo ${className}`}><img className="logo-light" src="/scout-logo.svg" alt=""/><img className="logo-dark" src="/scout-logo-dark.svg" alt=""/></span>;
}

export function PriorityBadge({priority,compact=false}:{priority:string;compact?:boolean}){
  return <span className={`priority-badge ${priority.toLowerCase()}${compact?' compact':''}`} title={compact?`${priority} priority`:undefined}><FiFlag aria-hidden="true"/>{compact?<span className="sr-only">{priority} priority</span>:priority}</span>;
}

const tones=['info','violet','positive','warning','negative'];
/** The same name always gets the same colour, so people and companies are recognisable at a glance. */
export function toneOf(name:string){let total=0;for(const letter of name)total+=letter.charCodeAt(0);return tones[total%tones.length]}

export function Avatar({name,url,className=''}:{name:string;url?:string;className?:string}){
  return <i className={`person-avatar tone-${toneOf(name)} ${className}`} aria-hidden="true">{url?<img src={url} alt=""/>:initialsOf(name)||'?'}</i>;
}

export function CompanyTile({name}:{name:string}){
  return <i className={`company-tile tone-${toneOf(name)}`} aria-hidden="true">{initialsOf(name)||'?'}</i>;
}

export function EmptyState({title,children,action}:{title:string;children?:React.ReactNode;action?:React.ReactNode}){
  return <div className="empty-state"><svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true"><path d="M53.4 21.6A23.8 23.8 0 0 1 21.6 53.4M10.6 42.4A23.8 23.8 0 0 1 42.4 10.6" fill="none" stroke="var(--line-strong)" strokeWidth="3.5" strokeLinecap="round"/><path d="M58.2 5.8 27 27l10 10Z" fill="var(--accent)"/><path d="M5.8 58.2 37 37 27 27Z" fill="var(--line-strong)"/></svg><h2>{title}</h2>{children&&<p>{children}</p>}{action&&<div className="empty-state-action">{action}</div>}</div>;
}

export function PageSkeleton(){
  return <div className="page-skeleton" role="status" aria-label="Loading">
    <div className="skeleton-line title"/>
    <div className="skeleton-line wide"/>
    {[0,1,2,3,4,5].map(row=><div className="skeleton-row" key={row}><div className="skeleton-line"/><div className="skeleton-line short"/></div>)}
  </div>;
}

/** A small menu that closes when you click elsewhere, for tools that don't need to be on screen all the time. */
export function ToolMenu({label,icon,children,disabled,active}:{label:string;icon:React.ReactNode;children:(close:()=>void)=>React.ReactNode;disabled?:boolean;active?:boolean}){
  const [open,setOpen]=useState(false);const wrap=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const dismiss=(event:PointerEvent)=>{if(!wrap.current?.contains(event.target as Node))setOpen(false)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape)}},[open]);
  return <div className="tool-menu" ref={wrap}><button className={`secondary${active?' active':''}`} disabled={disabled} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{icon}{label}</button>{open&&<div className="tool-menu-panel">{children(()=>setOpen(false))}</div>}</div>;
}
