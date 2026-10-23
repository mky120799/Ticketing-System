/**
 * Coloured labels for ticket states. Colour and wording come from lib/labels.ts, so a status looks the same on
 * every screen. The text always says what the colour means: colour is never the only signal (accessibility).
 */
import { Badge, type BadgeProps } from '@mantine/core';
import { priorityLook, regulatoryLook, sensitivityLook, slaLook, statusLook, type Look } from '../lib/labels';

type Size = BadgeProps['size'];
const LookBadge = ({ look, size = 'sm', variant = 'light' }: { look: Look; size?: Size; variant?: BadgeProps['variant'] }) => (
  <Badge color={look.color} variant={variant} size={size}>{look.label}</Badge>
);

export const StatusBadge = ({ status, size }: { status: string; size?: Size }) => <LookBadge look={statusLook(status)} size={size} />;
export const PriorityBadge = ({ priority, size }: { priority: string; size?: Size }) => <LookBadge look={priorityLook(priority)} size={size} variant="outline" />;
export const SlaBadge = ({ status, size }: { status: string | null | undefined; size?: Size }) => <LookBadge look={slaLook(status)} size={size} />;
export const RegulatoryBadge = ({ status, size }: { status: string | null | undefined; size?: Size }) => <LookBadge look={regulatoryLook(status)} size={size} />;
/** Standard sensitivity is the norm, so it is not shown unless `showStandard` is set. */
export function SensitivityBadge({ sensitivity, size, showStandard = false }: { sensitivity: string; size?: Size; showStandard?: boolean }) {
  if (sensitivity === 'standard' && !showStandard) return null;
  return <LookBadge look={sensitivityLook(sensitivity)} size={size} variant="outline" />;
}
