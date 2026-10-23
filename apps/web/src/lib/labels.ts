/**
 * One place that decides how each status, priority and SLA state looks: its colour and its words.
 * Keeping this in one table means the queue, the case screen and the dashboard can never disagree.
 *
 * Colour meaning used throughout:
 *   gray   = not started / neutral        blue  = being worked on
 *   yellow = waiting or at risk           red   = overdue or urgent
 *   green  = done / healthy               grape = escalated
 */
import { humanize } from './format';

export interface Look { color: string; label: string }

const look = (color: string, label?: string) => (code: string): Look => ({ color, label: label ?? humanize(code) });

const STATUS: Record<string, (code: string) => Look> = {
  submitted: look('gray', 'New'), triage: look('cyan'), assigned: look('blue'), in_progress: look('blue', 'In progress'),
  pending_customer: look('yellow', 'Waiting on customer'), pending_external: look('yellow', 'Waiting on third party'),
  pending_approval: look('yellow', 'Awaiting approval'),
  escalated: look('grape'), resolved: look('green'), closed: look('gray'), cancelled: look('gray'), reopened: look('orange')
};
export const statusLook = (status: string): Look => (STATUS[status] ?? look('gray'))(status);

const PRIORITY: Record<string, Look> = {
  low: { color: 'gray', label: 'Low' }, normal: { color: 'blue', label: 'Normal' },
  high: { color: 'orange', label: 'High' }, critical: { color: 'red', label: 'Critical' }
};
export const priorityLook = (priority: string): Look => PRIORITY[priority] ?? { color: 'gray', label: humanize(priority) };
/** Sort order for the priority column: critical first when sorting descending. */
export const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, critical: 3 };

/** SLA state of the service-level clock (from the SLA worker). A missing value means the clock is running normally. */
const SLA: Record<string, Look> = {
  running: { color: 'green', label: 'On track' }, on_track: { color: 'green', label: 'On track' },
  first_response_overdue: { color: 'yellow', label: 'Response overdue' }, breached: { color: 'red', label: 'Breached' },
  paused: { color: 'gray', label: 'Paused' }, met: { color: 'green', label: 'Met' }
};
export const slaLook = (status: string | null | undefined): Look => SLA[status ?? 'running'] ?? { color: 'gray', label: humanize(status) };
/** True when the ticket has missed a target and should be in the "Overdue" view. */
export const isOverdue = (slaStatus: string | null | undefined): boolean => slaStatus === 'breached' || slaStatus === 'first_response_overdue';

/** Regulatory clock for complaints (e.g. Australian RG 271): acknowledge quickly, final response within 30 days. */
const REGULATORY: Record<string, Look> = {
  on_track: { color: 'green', label: 'On track' }, met: { color: 'green', label: 'Met' }, at_risk: { color: 'yellow', label: 'At risk' },
  ack_overdue: { color: 'red', label: 'Acknowledgement overdue' }, final_response_overdue: { color: 'red', label: 'Final response overdue' }
};
export const regulatoryLook = (status: string | null | undefined): Look => REGULATORY[status ?? 'on_track'] ?? { color: 'gray', label: humanize(status) };

const SENSITIVITY: Record<string, Look> = {
  standard: { color: 'gray', label: 'Standard' }, confidential: { color: 'indigo', label: 'Confidential' }, restricted: { color: 'red', label: 'Restricted' }
};
export const sensitivityLook = (sensitivity: string): Look => SENSITIVITY[sensitivity] ?? { color: 'gray', label: humanize(sensitivity) };

/** Malware scanning state of an attachment. Only "clean" files can be downloaded. */
const MALWARE: Record<string, Look> = {
  pending: { color: 'yellow', label: 'Scanning' }, pending_scan: { color: 'yellow', label: 'Scanning' }, clean: { color: 'green', label: 'Clean' },
  malicious: { color: 'red', label: 'Blocked: malware' }, error: { color: 'red', label: 'Scan failed' }
};
export const malwareLook = (status: string): Look => MALWARE[status] ?? { color: 'gray', label: humanize(status) };

/** Delivery state of a customer communication. */
const COMMUNICATION: Record<string, Look> = {
  pending_approval: { color: 'yellow', label: 'Awaiting approval' }, queued: { color: 'blue', label: 'Queued' }, sent: { color: 'green', label: 'Sent' },
  delivered: { color: 'green', label: 'Delivered' }, rejected: { color: 'red', label: 'Rejected' }, failed: { color: 'red', label: 'Failed' }, blocked: { color: 'red', label: 'Blocked' }
};
export const communicationLook = (status: string): Look => COMMUNICATION[status] ?? { color: 'gray', label: humanize(status) };
