/**
 * Service requests: a customer asks the insurer about a policy they hold.
 *
 * The moves are the server's (`apps/api/src/service-requests/domain`); they are
 * repeated here so the screens offer only what the server will accept, and so
 * the mock lane behaves the same. If you change one, change both.
 */

export const SERVICE_REQUEST_TYPES = [
  {
    id: 'DETAILS_CHANGE',
    label: 'Correct my details',
    detail: 'Something on the policy is wrong, such as your contact details or the vehicle colour.',
  },
  {
    id: 'DOCUMENT_REPLACEMENT',
    label: 'Replace a document',
    detail: 'You need a new copy of your certificate or another policy document.',
  },
  {
    id: 'CANCELLATION',
    label: 'Cancel my cover',
    detail: 'You no longer need the cover, for example because you sold the vehicle. The insurer works out any refund.',
  },
  {
    id: 'ASSISTANCE',
    label: 'Ask for help',
    detail: 'Anything else you need from the insurer about this policy.',
  },
];

export const typeLabel = (type) => SERVICE_REQUEST_TYPES.find((entry) => entry.id === type)?.label ?? type;

export const STATUS_LABELS = {
  SUBMITTED: 'Sent to the insurer',
  IN_REVIEW: 'Being reviewed',
  INFORMATION_REQUIRED: 'Waiting for you',
  APPROVED: 'Approved',
  COMPLETED: 'Done',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

/** The insurer's words for the same states, as its queue reads them. */
export const INSURER_STATUS_LABELS = {
  ...STATUS_LABELS,
  SUBMITTED: 'New',
  INFORMATION_REQUIRED: 'Waiting for the customer',
};

export const statusLabel = (status) => STATUS_LABELS[status] ?? status;

export const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED', 'APPROVED'];
export const isOpen = (status) => OPEN_STATUSES.includes(status);

const MOVES = {
  REVIEW: { from: ['SUBMITTED'], to: 'IN_REVIEW' },
  REQUEST_INFORMATION: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'INFORMATION_REQUIRED' },
  REPLY: { from: ['INFORMATION_REQUIRED'], to: 'IN_REVIEW' },
  APPROVE: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'APPROVED' },
  DECLINE: { from: ['SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED'], to: 'DECLINED' },
  COMPLETE: { from: ['APPROVED'], to: 'COMPLETED' },
  WITHDRAW: { from: OPEN_STATUSES, to: 'WITHDRAWN' },
  UPDATE: { from: OPEN_STATUSES, to: null },
};

export const canMove = (action, status) => MOVES[action]?.from.includes(status) ?? false;
export const statusAfter = (action, status) => MOVES[action]?.to ?? status;

/**
 * Whether the insurer can record the request as done from where it stands. A
 * correction, replacement or help is approved and completed in one step; a
 * cancellation is approved first, with its refund and end date.
 */
export const canComplete = (request) =>
  canMove('COMPLETE', request.status) || (request.type !== 'CANCELLATION' && canMove('APPROVE', request.status));

/** Policies a customer may ask about, and the ones they may cancel. */
export const canAskAbout = (policy) => ['Active', 'Awaiting insurer certificate'].includes(policy?.status);
export const canCancel = (policy) => policy?.status === 'Active';

/** Today as a Lusaka calendar day, `YYYY-MM-DD`, for the earliest cancellation date. */
export const lusakaToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The roles at an insurer who may work a request, as the API's permission table names them. */
export const SERVICE_REQUEST_HANDLER_ROLES = ['INSURER_ADMIN', 'INSURER_USER', 'SUPPORT'];
