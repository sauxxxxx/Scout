-- People who run Scout but don't sell (IT, admins) can be left out of sales reports and assignment.
ALTER TABLE workspace_memberships ADD COLUMN in_sales INTEGER NOT NULL DEFAULT 1;
