/**
 * Toast messages (small pop-ups in the corner). Successes confirm an action; errors explain why it failed.
 * They replace the old single red banner at the top of the page, which was easy to miss and never went away.
 */
import { notifications } from '@mantine/notifications';
import { errorMessage } from './format';

/** The close button is an icon only, so it needs a name for screen readers (found by the axe accessibility check). */
const closeButtonProps = { 'aria-label': 'Dismiss message' };

export function notifySuccess(message: string, title?: string): void {
  notifications.show({ color: 'green', title, message, autoClose: 4000, closeButtonProps });
}

export function notifyError(error: unknown, title = 'That did not work'): void {
  // Errors stay a little longer: people need time to read why something was refused.
  notifications.show({ color: 'red', title, message: errorMessage(error), autoClose: 8000, closeButtonProps });
}
