Scout is currently a strong interactive prototype, but not yet a production-ready CRM. Activities is the most complete area; several other sections still contain simulated, local-only, or disconnected behavior.

## Production blockers

- [x] **No authentication:** Anyone with access can view and change everything.
  - [ ] Suggestion: add sign-in, sessions, password recovery, and account management.

- [x] **No roles or permissions:** Shaun, Mika, and Paolo are hardcoded labels rather than real users.
  - [ ] Suggestion: create users, teams, invitations, roles, record ownership, and permission rules.

- [x] **Unsafe multi-user persistence:** Leads and tasks are saved as entire collections, so concurrent sessions could overwrite one another.
  - [x] Suggestion: use individual create/update/delete endpoints with optimistic concurrency.

- [x] **Lead names are record identifiers:** Renaming a business could break task, activity, and opportunity relationships.
  - [x] Suggestion: give every lead, contact, task, activity, and opportunity an immutable ID.

- [x] **Limited server validation:** Most input rules exist only in the interface.
  - [ ] Suggestion: validate every mutation on the server, including URLs, statuses, file metadata, dates, and ownership.

- [x] **No automated tests:** There are no unit, integration, or end-to-end tests.
  - [ ] Suggestion: cover lead creation, status changes, task scheduling, pipeline movement, imports, attachments, and persistence.

- [ ] **No monitoring or recovery tools:** No error tracking, operation logs, backups, or data export.
  - [ ] Suggestion: add structured logging, error reporting, backups, and workspace export.

## Global shell and navigation

These are currently visual-only:

- [ ] Sales workspace selector
- [ ] Notification bell
- [ ] User avatar/account menu
- [x] Settings icon
- [ ] Top-right overflow menu
- [ ] Breadcrumb navigation
- [ ] “Search this view”

The command menu opens, but its search input does not actually search records.

Suggestions:

- [ ] Turn global search into grouped results for leads, tasks, activities, and opportunities.
- [ ] Add a notification center for reminders, assignments, failed syncs, and mentions.
- [ ] Add workspace and account menus.
- [x] Build a real Settings area.
- [ ] Give Leads, Tasks, Pipeline, and details stable URLs.
- [ ] Support browser Back/Forward navigation.
- [ ] Show connection and synchronization state instead of relying only on temporary toasts.

## Overview

Mostly visual or simulated:

- [ ] Pipeline movement chart is hardcoded.
- [ ] Activity Volume tab does nothing.
- [ ] “30 days” does nothing.
- [ ] Chart overflow menu does nothing.
- [ ] Overview sidebar items—My day, Team pulse, Campaigns—do nothing.
- [ ] “View all 16” uses a hardcoded count.
- [ ] Follow-ups come from lead text rather than the task database.
- [ ] Completing a follow-up only changes temporary Overview state.
- [ ] No date comparison, drill-down, or team filtering.

Suggested redesign:

- [ ] Use real KPI data: pipeline value, weighted forecast, conversion, activities, overdue work, and won revenue.
- [ ] Replace the fake movement chart with actual stage-history data.
- [ ] Make every metric drill into its source records.
- [ ] Use the actual task list for “Today.”
- [ ] Add a real date-range and comparison control.
- [ ] Either implement the Overview sidebar views or remove them.

## Leads

Functional foundations exist, but the workflow remains partial:

- [x] Business and contact information cannot be edited after creation.
- [ ] Leads cannot be archived, deleted, restored, or merged.
- [ ] Duplicate detection only checks simple name, city, and phone matches.
- [ ] Email and phone validation is weak.
- [x] No company/contact separation.
- [x] No multiple contacts per business.
- [ ] No tags, sources, custom fields, or consent information.
- [ ] Lead scoring is static; there is no scoring model or explanation.
- [ ] “Recently added” depends on display text such as “Today,” not a real creation timestamp.
- [ ] Lead filters and sorting are not preserved in the URL.
- [ ] No pagination for large lead collections.
- [ ] No import/export.
- [ ] Bulk status changes skip the normal confirmation workflow.
- [ ] Bulk activity records may show an incorrect acting owner.
- [ ] Contact phone and email are plain text rather than actionable links.
- [ ] Activity history can include inconsistent old records and has no dedicated tabs.

Disconnected quick actions:

- [ ] Follow-up updates lead text but does not always create a task and reminder.
- [ ] Proposal does not create or attach a proposal document.
- [ ] Log call does not connect to telephony.
- [ ] Email cannot be sent or tracked.
- [ ] Notes have no mentions, attachments, or editing history.

Suggested redesign:

- [ ] Make the lead drawer the central workspace with **Overview, Activity, Tasks, Opportunities, and Files** tabs.
- [ ] Allow inline editing with explicit save states.
- [x] Separate companies and contacts.
- [ ] Add archive, merge, duplicate review, and restore workflows.
- [ ] Route every quick action through the same Activities and Tasks services.
- [ ] Add server pagination and stable lead URLs.

## Lead Finder

This is the largest simulated feature:

- [ ] Search results always come from a hardcoded list.
- [ ] Industry, location, lead count, and required-information options do not change the data returned.
- [ ] Search progress is a timer animation rather than real work.
- [ ] Phone, email, website, and social information are not verified.
- [ ] Sources are labels rather than linked evidence.
- [ ] Fit scores are hardcoded.
- [ ] Saved searches and campaign history are not persisted.
- [ ] Navigating away can reset Finder state.
- [ ] Re-running a search returns the same sample businesses.
- [ ] Result count is not respected.
- [ ] No server pagination.
- [ ] No background search jobs.
- [ ] Imported leads do not consistently generate import activities or first-follow-up tasks.
- [ ] Search deletion has no confirmation or recovery.
- [ ] “Campaigns” currently means search history—it is not a campaign workflow.
- [ ] No email sequence, audience, message, launch, or performance tracking.

Suggested redesign:

- [ ] Connect Finder to a real business-data provider.
- [ ] Show source provenance and verification dates.
- [ ] Persist search jobs, criteria, results, and imports.
- [ ] Add pagination, enrichment status, retry, and partial-result handling.
- [ ] Rename Campaigns to **Search history** until an actual outbound campaign system exists.
- [ ] If campaigns are desired, build them separately with audience, sequence, scheduling, delivery, replies, and reporting.

## Pipeline

Functional Kanban movement exists, but the underlying model is incomplete:

- [ ] Pipeline sidebar items—All pipeline, My pipeline, Forecast—do nothing.
- [x] An opportunity is stored inside a lead instead of being its own record.
- [x] A lead can only have one practical opportunity.
- [ ] Opportunity name cannot be edited independently.
- [x] “Add opportunity” modifies an existing lead rather than creating a proper opportunity.
- [ ] Forecast view does not exist.
- [ ] No monthly/quarterly forecast buckets.
- [ ] No sales targets, quotas, or forecast categories.
- [ ] Pipeline stages cannot be configured.
- [ ] Currency is hardcoded.
- [ ] Close dates and values have limited validation.
- [ ] Owner, value, probability, and close-date changes are not fully audited.
- [ ] Archived opportunities have no archive/restore view.
- [ ] Open-task display still misses some task statuses.
- [ ] No pipeline URL state, pagination, or advanced filtering.
- [ ] Dragging is not keyboard- or touch-accessible.

Suggested redesign:

- [x] Create a dedicated Opportunity entity linked to a lead.
- [x] Support multiple opportunities per business.
- [ ] Add List, Kanban, and Forecast views.
- [ ] Add configurable stages, probabilities, currency, close dates, and loss reasons.
- [ ] Add an opportunity drawer with activity, contacts, tasks, files, and stage history.
- [ ] Make closed opportunities recoverable and reportable.

## Tasks and calendar

Many task interactions work, but several important parts are incomplete:

- [ ] The page tabs and sidebar filters are duplicated and can become disconnected.
- [ ] Recurrence values are stored but recurring tasks are never generated.
- [ ] Reminders work only while Scout is open.
- [ ] No durable notification inbox.
- [ ] No browser, email, mobile, or calendar notification delivery.
- [ ] Dates are stored as labels such as “Today” and “Tomorrow,” causing rollover and timezone problems.
- [ ] No real task duration or end time.
- [ ] No all-day control.
- [ ] No calendar conflict detection.
- [ ] No recurring-series editing.
- [ ] No undo or restore after task deletion.
- [ ] No task comments, attachments, watchers, or assignment history.
- [ ] No batch rescheduling.
- [ ] No Google or Outlook Calendar synchronization.
- [ ] Drag-and-drop lacks keyboard and touch support.
- [ ] Board and calendar filters are not preserved in URLs.
- [ ] Large task sets are not paginated.

Suggested redesign:

- [ ] Use actual timestamp fields with workspace timezone.
- [ ] Keep one filtering hierarchy instead of both sidebar and duplicate page tabs.
- [ ] Add an Agenda mode alongside List, Calendar, and Board.
- [ ] Implement a recurrence engine and background reminder delivery.
- [ ] Add delete recovery and task audit history.
- [ ] Allow task duration, attachments, comments, and external-calendar sync.

## Activities

Activities is now the strongest workflow, but these limitations remain:

- [ ] Reminder delivery still requires Scout to be open.
- [ ] Retention cleanup runs when activity data is requested rather than through a scheduled background process.
- [x] Activity creation and updates still rely partly on whole-client synchronization instead of isolated record mutations.
- [ ] Relationships are not protected by database foreign keys.
- [ ] No record version history or audit revisions.
- [ ] No bulk actions or export.
- [ ] No configurable activity types.
- [ ] No timezone control.
- [ ] Attachments have no malware scanning, type restrictions, versions, or inline previews.
- [ ] External document links are validated but not monitored for availability.
- [ ] System activities cannot be inspected for their underlying change metadata.
- [ ] Activity filters support URLs, but individual activities do not have shareable URLs.
- [ ] The code still contains an unused legacy Activities implementation that should be removed.

Suggested improvements:

- [x] Add per-record create/update APIs and relationship constraints.
- [ ] Add durable notification delivery and scheduled cleanup.
- [ ] Add activity permalink URLs and revision history.
- [ ] Add attachment previews and security scanning.
- [ ] Remove the legacy implementation and split Activities into smaller components.

## Campaigns and automation

These core CRM capabilities do not yet exist:

- [ ] Email sequences
- [ ] Automated follow-ups
- [ ] Lead assignment rules
- [ ] Stage-triggered actions
- [ ] Stale-lead alerts
- [ ] Task templates
- [ ] Proposal automation
- [ ] Webhooks
- [ ] Form capture
- [ ] Email reply tracking
- [ ] Campaign analytics
- [ ] Workflow builder
- [ ] Automation execution history
- [ ] Retry and failure handling

Suggestion: build Automations as a dedicated module only after contacts, opportunities, and tasks have stable database models.

## Reporting

There is no complete reporting system yet:

- [ ] No conversion funnel
- [ ] No source attribution
- [ ] No sales-cycle reporting
- [ ] No activity-to-outcome analysis
- [ ] No owner performance
- [ ] No forecast accuracy
- [ ] No won/lost analysis
- [ ] No revenue history
- [ ] No scheduled reports
- [ ] No exportable reports

Suggestion: record immutable stage history and activity timestamps first, then build reporting from that data.

## Settings and administration

Missing completely:

- [ ] Workspace profile
- [x] User management
- [x] Roles and permissions
- [ ] Pipeline-stage configuration
- [ ] Lead-status configuration
- [ ] Custom fields
- [ ] Activity types
- [ ] Task defaults
- [ ] Currency and timezone
- [ ] Data retention
- [ ] Notification preferences
- [ ] Integrations
- [ ] Import/export
- [ ] Audit log
- [ ] Billing or usage controls

## Accessibility and responsive design

Needs further work:

- [ ] Drawers and modals do not consistently trap or restore focus.
- [ ] Escape does not close every overlay consistently.
- [ ] Toasts are not announced through an accessible live region.
- [ ] Custom dropdown keyboard behavior is incomplete.
- [ ] Drag-and-drop has no accessible alternative.
- [ ] Some icon buttons lack complete labels.
- [ ] Dense tables hide important fields on smaller screens.
- [ ] The contextual sidebar disappears on tablets without a replacement menu.
- [ ] Kanban and calendar rely heavily on horizontal scrolling.
- [ ] Touch targets and mobile drawer behavior need dedicated testing.

Suggested redesign:

- [ ] Add a responsive navigation drawer.
- [ ] Convert wide tables to compact record rows on mobile.
- [ ] Provide non-drag move controls.
- [ ] Standardize focus management, labels, announcements, and keyboard navigation.

## Architecture and maintainability

- [ ] Most of Scout lives in one very large page file.
- [ ] Legacy Tasks and Activities implementations remain in the source.
- [ ] Business rules are mixed directly into interface components.
- [ ] Data types, validation, API calls, and UI state are tightly coupled.
- [ ] Owners, statuses, stages, activity types, and currency are hardcoded.
- [ ] Error handling is mostly temporary toast messages.
- [ ] No shared mutation layer or optimistic rollback.
- [x] No conflict detection.
- [ ] No loading skeletons or comprehensive empty/error states.
- [x] No test suite.
- [ ] The social metadata still points to the earlier hosted Scout domain, which may be wrong for the eventual production domain.

Suggested architecture:

1. [ ] Split each feature into its own module.
2. [ ] Add separate services for leads, contacts, opportunities, tasks, activities, and Finder searches.
3. [ ] Use schema validation for every API.
4. [x] Replace full-collection synchronization with record-level operations.
5. [ ] Add stable IDs and foreign-key relationships.
6. [x] Add tests before expanding automation and integrations.

## Recommended priority

1. [x] **Foundation:** authentication, users, roles, stable IDs, safe record APIs, validation, tests.
2. [x] **Core CRM model:** separate contacts, companies, and opportunities.
3. [ ] **Repair current workflows:** Overview, Lead actions, Task dates/recurrence, and Pipeline views.
4. [ ] **Real Finder:** external data, persistent searches, provenance, and background jobs.
5. [ ] **Communication:** email, calls, proposals, calendar integration, and notifications.
6. [ ] **Automation and reporting:** only after the underlying event history is reliable.
7. [ ] **Final redesign pass:** responsive navigation, accessibility, empty states, and component cleanup.

The most misleading areas right now are **Overview**, **Lead Finder**, the global header controls, Pipeline’s secondary views, and Task recurrence/reminders. Those should be addressed before adding more surface area.
