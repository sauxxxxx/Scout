-- Messenger, WhatsApp, Viber and Instagram links Finder finds on a business's own website.
ALTER TABLE finder_results ADD COLUMN channels_json TEXT NOT NULL DEFAULT '{}';
