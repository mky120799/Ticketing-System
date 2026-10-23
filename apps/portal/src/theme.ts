/**
 * The customer portal's Mantine theme. It mirrors the staff console's theme (apps/web/src/theme.ts) so both
 * products share one brand colour and the same accessible colour overrides; a bank re-brands both by changing
 * the `bank` palette here and there.
 *
 * The portal is used by the public, so it is tuned for readability: a slightly larger base font size and
 * generous spacing. Every colour used for text passes WCAG AA contrast (4.5:1).
 */
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

const bank: MantineColorsTuple = ['#e7f1fa', '#cfe1f2', '#a3c6e6', '#73a8d9', '#4b8ecd', '#2f7ec6', '#1a6fb5', '#075a9c', '#054a82', '#033a68'];

export const theme = createTheme({
  primaryColor: 'bank',
  primaryShade: 7,
  colors: { bank },
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSizes: { md: '1.0625rem' }, // 17px body text: easier to read for everyone
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Paper: { defaultProps: { withBorder: true, radius: 'md' } },
    // Sentence case reads more easily than Mantine's default ALL CAPS badges.
    Badge: { defaultProps: { tt: 'none' }, styles: { label: { overflow: 'visible' } } }
  }
});

/** Darker text shades so badges, alerts and secondary text meet contrast requirements on white. */
const ACCESSIBLE_TEXT: Record<string, string> = { bank: '#054a82', blue: '#0b4f8a', red: '#a61b1b', green: '#1e6b33', yellow: '#7a5200', orange: '#9a3d00', gray: '#495057', teal: '#0b6b5e' };

export const cssVariablesResolver: CSSVariablesResolver = () => {
  const light: Record<string, string> = { '--mantine-color-dimmed': '#5c6670', '--mantine-color-error': ACCESSIBLE_TEXT.red };
  for (const [color, text] of Object.entries(ACCESSIBLE_TEXT)) {
    light[`--mantine-color-${color}-text`] = text;
    light[`--mantine-color-${color}-light-color`] = text;
    light[`--mantine-color-${color}-outline`] = text;
    if (color !== 'bank') { light[`--mantine-color-${color}-filled`] = text; light[`--mantine-color-${color}-filled-hover`] = text; }
  }
  return { variables: {}, light, dark: {} };
};
