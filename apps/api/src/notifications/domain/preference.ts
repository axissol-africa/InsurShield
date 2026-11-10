import type { NotificationCategory, NotificationChannel } from '../../common/domain/enums.js';

export interface Preference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface Addressed {
  category: NotificationCategory;
  channel: NotificationChannel;
  mandatory: boolean;
}

/**
 * Whether a message may be sent on a channel.
 *
 * Two rules, in this order. A mandatory message is sent whatever the customer
 * has chosen — US-CUS-004 requires that disabling marketing never suppresses a
 * notice that is legally or operationally required. Anything else is sent
 * unless the customer has turned that category off on that channel.
 *
 * Silence is consent to be told: a customer who has never opened the preference
 * screen has no rows, and still hears about their own quote. Only an explicit
 * `false` suppresses.
 */
export function maySend(message: Addressed, preferences: Preference[]): boolean {
  if (message.mandatory) return true;
  const choice = preferences.find(
    (preference) => preference.category === message.category && preference.channel === message.channel,
  );
  return choice?.enabled ?? true;
}

/**
 * Why a message went out despite preferences, for the row that records it.
 * Only mandatory messages can override a choice, so that is the only rule
 * there is to name; it exists as a function so a second rule has somewhere
 * to go rather than being written into the caller.
 */
export function overriddenBy(message: Addressed, preferences: Preference[]): 'mandatory' | null {
  if (!message.mandatory) return null;
  const choice = preferences.find(
    (preference) => preference.category === message.category && preference.channel === message.channel,
  );
  return choice?.enabled === false ? 'mandatory' : null;
}
