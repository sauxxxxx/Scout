'use client';

import { useLayoutEffect, useMemo, useRef, useState, createContext, useCallback, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiChevronDown } from 'react-icons/fi';
import { localIso } from '@/lib/task-dates';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import type { Page, TaskItem, FloatingMenuPosition } from '@/lib/crm-types';

export const routePages:Page[]=['Overview','Leads','Finder','Pipeline','Tasks','Activities','Profile','Settings'];

export const routeViews:Partial<Record<Page,string[]>>={Leads:['Leads','Companies','Contacts','Assigned to me','Recently added','High priority','Archived'],Finder:['New search','Search history','Saved searches'],Pipeline:['All pipeline','My pipeline','Forecast','Archived'],Tasks:['Today','Upcoming','Overdue','Completed'],Activities:['All activity','Calls','Notes','Proposals'],Profile:['Profile','Preferences','Notifications','Security']};

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

export function CustomSelect({value,options:allOptions,onChange,placeholder,label,onSearch}:{value:string;options:string[];onChange:(value:string)=>void;placeholder?:string;label?:string;onSearch?:(query:string)=>void}) {
  const [search,setSearch]=useState('');const options=search?allOptions.filter(option=>option.toLowerCase().includes(search.toLowerCase())):allOptions;
  useEffect(()=>{if(!onSearch||search.trim().length<2)return;const timer=window.setTimeout(()=>onSearch(search.trim()),250);return()=>window.clearTimeout(timer)},[search,onSearch]);
  const [open,setOpen]=useState(false); const [active,setActive]=useState(Math.max(0,options.indexOf(value))); const trigger=useRef<HTMLButtonElement>(null); const position=useFloatingMenu(open,trigger,options);
  const choose=(option:string)=>{onChange(option);setOpen(false)};
  const keys=(e:React.KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(options.length-1,i+1))}if(e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>Math.max(0,i-1))}if(e.key==='Enter'&&open){e.preventDefault();choose(options[active])}};
  const menu=open&&position&&<div className={`select-menu floating-select-menu placement-${position.placement}`} style={{top:position.top,bottom:position.bottom,left:position.left,width:position.width,maxHeight:position.maxHeight}} role="listbox" onMouseDown={e=>{if((e.target as Element).tagName!=='INPUT')e.preventDefault()}}>{onSearch&&<input className="select-search" autoFocus placeholder="Search…" aria-label="Search options" value={search} onChange={event=>{setSearch(event.target.value);setActive(0)}}/>}{options.map((option,i)=><button type="button" role="option" aria-selected={option===value} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>choose(option)} key={option}><span>{option}</span>{option===value&&<FiCheck/>}</button>)}</div>;
  return <div className="custom-select" onKeyDown={keys} onBlur={e=>!e.currentTarget.contains(e.relatedTarget)&&!(e.relatedTarget as Element|null)?.closest?.('.floating-select-menu')&&setOpen(false)}>{label&&<span className="select-label">{label}</span>}<button ref={trigger} type="button" className="select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span>{value||placeholder||'Select'}</span><FiChevronDown/></button>{menu&&createPortal(menu,document.body)}</div>
}

export function OwnerSelect({value,onChange,allLabel,placeholder}:{value:string;onChange:(value:string)=>void;allLabel?:string;placeholder?:string}) {
  const names=useWorkspaceMembers().assignableMembers.map(member=>member.name);
  const options=[...(allLabel?[allLabel]:[]),...names,...(!allLabel&&value&&!names.includes(value)?[value]:[])];
  return <CustomSelect value={value} options={options} onChange={onChange} placeholder={placeholder}/>
}

export function StatusSelect({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const [open,setOpen]=useState(false); const options=useMemo(()=>['New','Contacted','Interested','Follow-up','Proposal','Negotiation','Won','Lost'],[]); const trigger=useRef<HTMLButtonElement>(null); const position=useFloatingMenu(open,trigger,options); const statusClass=(name:string)=>name.toLowerCase().replace('-','');
  const menu=open&&position&&<div className={`select-menu status-menu floating-select-menu placement-${position.placement}`} style={{top:position.top,bottom:position.bottom,left:position.left,width:position.width,maxHeight:position.maxHeight}} role="listbox" onMouseDown={e=>e.preventDefault()}>{options.map(option=><button type="button" role="option" aria-selected={option===value} onClick={()=>{onChange(option);setOpen(false)}} key={option}><span><i className={`status-dot ${statusClass(option)}`}/>{option}</span>{option===value&&<FiCheck/>}</button>)}</div>;
  return <div className="row-status-select" onClick={e=>e.stopPropagation()} onBlur={e=>!e.currentTarget.contains(e.relatedTarget)&&setOpen(false)}><button ref={trigger} type="button" className="row-status-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><i className={`status-dot ${statusClass(value)}`}/><span>{value}</span><FiChevronDown/></button>{menu&&createPortal(menu,document.body)}</div>
}

type LeadPage={total:number;stats?:{active:number;attention:number;proposals:number};industries?:string[]};
export type CrmData={
  loadLeads:(params:Record<string,string>)=>Promise<LeadPage|null>;
  searchLeads:(query:string)=>void;
  loadCompanies:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadContacts:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadCompletedTasks:(params:Record<string,string>)=>Promise<{total:number}|null>;
  loadHistory:(filter:{leadId?:string;companyId?:string})=>void;
};
const nothing=async()=>null;
export const CrmDataContext=createContext<CrmData>({loadLeads:nothing,searchLeads:()=>{},loadCompanies:nothing,loadContacts:nothing,loadCompletedTasks:nothing,loadHistory:()=>{}});
export const useCrmData=()=>useContext(CrmDataContext);

/** Asks the server for matching records as filters change. Results join the local cache, and the screen's own filtering shows them. */
export function useServerPages<R extends {total:number}>(load:(params:Record<string,string>)=>Promise<R|null>,params:Record<string,string>,pageSize=100){
  const key=JSON.stringify(params);const [page,setPage]=useState(1);const [result,setResult]=useState<R|null>(null);
  useEffect(()=>{let active=true;const timer=window.setTimeout(()=>{load({...JSON.parse(key) as Record<string,string>,page:'1',pageSize:String(pageSize)}).then(value=>{if(active){setResult(value);setPage(1)}}).catch(()=>{})},250);return()=>{active=false;window.clearTimeout(timer)}},[key,load,pageSize]);
  const more=useCallback(()=>{const next=page+1;setPage(next);load({...JSON.parse(key) as Record<string,string>,page:String(next),pageSize:String(pageSize)}).catch(()=>{})},[page,load,pageSize,key]);
  return {result,total:result?.total??null,hasMore:!!result&&page*pageSize<result.total,more};
}
