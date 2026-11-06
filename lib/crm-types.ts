import type { SyncProblem } from '@/lib/use-record-sync';
import type { CapabilitySet } from '@/lib/permissions';

export type Page = 'Overview' | 'Leads' | 'Finder' | 'Pipeline' | 'Tasks' | 'Activities' | 'Reports' | 'Profile' | 'Settings';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type Session = {emailLogAddress?:string;customization?:import('@/lib/customization').Customization;user:{id:string;email:string;name:string;avatarUrl?:string};workspace:{id:string;name:string};workspaces?:{id:string;name:string}[];timezone?:string;role:WorkspaceRole;customRole?:{id:string;name:string};capabilities?:CapabilitySet;canInvite?:boolean;localDevelopment?:boolean};

export type FacebookResearch=Partial<import('@/lib/finder-sales').FacebookResearch>;

export type Company={id:string;version:number;name:string;industry:string;city:string;phone:string;email:string;website?:string;facebookUrl?:string;facebookStatus:'confirmed'|'possible'|'not_found';facebookReviewedAt?:string;facebookResearch:FacebookResearch;owner:string;archived:boolean};

export type Contact={id:string;version:number;companyId:string;name:string;title?:string;email:string;phone:string;isPrimary:boolean;archived:boolean};

export type Opportunity={fromFinder?:boolean;id:string;version:number;companyId:string;leadId?:string;primaryContactId?:string;name:string;stage:string;value:number;probability:number;closeDate?:string;owner:string;priority:string;outcome?:string;archived:boolean;closedAt?:string};

export type Lead = { id?:string; createdAt?:string; version?:number; companyId?:string;primaryContactId?:string; name:string; industry:string; city:string; country?:string; status:string; score:number; owner:string; last:string; lastTouchAt?:string; changedAt?:string; next:string; phone:string; email:string; contact:string; priority:string; opportunity:string; value?:number; probability?:number; closeDate?:string; archived?:boolean };

export type ActivityEntry = { uid?:string; id:number; version?:number; lead:string; leadId?:string;companyId?:string;contactId?:string;opportunityId?:string; type:string; detail:string; time:string; owner:string; status?:'Completed'|'Scheduled'; occurredAt?:string; outcome?:string; duration?:string; subject?:string; value?:string; documentLink?:string; attachmentKey?:string; attachmentName?:string; relatedTaskId?:number; relatedTaskUid?:string; opportunity?:string; deletedAt?:string };

export type TaskItem = { uid?:string; id:number; version?:number; title:string; lead:string; leadId?:string;companyId?:string;contactId?:string;opportunityId?:string; owner:string; priority:string; due:string; dueAt?:string; time:string; type:string; notes:string; status:'Open'|'Backlog'|'Scheduled'|'In progress'|'Waiting'|'Completed'; reminder?:string; recurrence?:string; outcome?:string };

export type ProblemSource='leads'|'tasks'|'activities';

export type Problem=SyncProblem&{source:ProblemSource};

export type AppNotification={id:string;title:string;body:string;link:string;read:boolean;createdAt:string};

export type FloatingMenuPosition={top?:number;bottom?:number;left:number;width:number;maxHeight:number;placement:'up'|'down'};

export type ActivityFormState={type:string;lead:string;owner:string;detail:string;status:'Completed'|'Scheduled';occurredAt:string;outcome:string;duration:string;subject:string;value:string;documentLink:string;relatedTask:string;opportunity:string;attachmentKey:string;attachmentName:string};
