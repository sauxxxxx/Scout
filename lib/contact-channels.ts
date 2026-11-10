/** Messaging channels found on a business website, in the order reps usually try them in the Philippines. */
export type ContactChannels = { messenger?: string; whatsapp?: string; viber?: string; instagram?: string };

const labels: [keyof ContactChannels, string][] = [['messenger', 'Messenger'], ['viber', 'Viber'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']];

export function channelList(channels?: ContactChannels) {
  return labels.flatMap(([key, label]) => channels?.[key] ? [{ label, url: channels[key]! }] : []);
}
