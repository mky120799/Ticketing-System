/**
 * The console's visual identity, expressed as a Mantine theme.
 *
 * Two jobs:
 *  1. Brand: a "bank" blue palette is the primary colour, so buttons, links and active tabs share one colour.
 *     A bank re-brands the product by changing this palette (and the name in the header), nothing else.
 *  2. Accessibility: Mantine's stock colours are a little light for WCAG AA text contrast (4.5:1) on white,
 *     e.g. white text on blue-6 is about 3.6:1. Our automated accessibility checks (axe, in the Playwright
 *     tests) would fail. `cssVariablesResolver` below swaps in darker shades wherever a colour is used for text
 *     or behind white text, so every badge, button and "dimmed" caption passes.
 */
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

/** Ten shades from lightest (0) to darkest (9). Shade 7 (#075a9c) is the brand colour and the filled-button colour. */
const bank: MantineColorsTuple = ['#e7f1fa', '#cfe1f2', '#a3c6e6', '#73a8d9', '#4b8ecd', '#2f7ec6', '#1a6fb5', '#075a9c', '#054a82', '#033a68'];

export const theme = createTheme({
  primaryColor: 'bank',
  primaryShade: 7,
  colors: { bank },
  // System fonts: nothing is downloaded from a font CDN, which keeps the Content-Security-Policy strict.
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontWeight: '650' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    // Cards and papers get a hairline border instead of a heavy shadow: calmer for a screen used all day.
    Paper: { defaultProps: { withBorder: true, radius: 'md' } },
    Card: { defaultProps: { withBorder: true, radius: 'md' } },
    // Sentence case instead of Mantine's ALL CAPS: calmer, and narrow enough that "In progress" never gets cut off.
    Badge: { defaultProps: { radius: 'sm', tt: 'none' }, styles: { label: { overflow: 'visible' } } },
    Tooltip: { defaultProps: { withArrow: true } }
  }
});

/**
 * Accessible text colour for each palette colour we use. Picked to give at least 4.5:1 on white and on the
 * pale tinted background of "light" badges, and at least 4.5:1 for white text on top of them.
 */
const ACCESSIBLE_TEXT: Record<string, string> = {
  bank: '#054a82', blue: '#0b4f8a', red: '#a61b1b', green: '#1e6b33', yellow: '#7a5200', orange: '#9a3d00',
  gray: '#495057', grape: '#7a1f8f', teal: '#0b6b5e', cyan: '#0b6477', violet: '#5a2fc2', indigo: '#3b48b8', pink: '#9c1f5a'
};

export const cssVariablesResolver: CSSVariablesResolver = () => {
  const light: Record<string, string> = {
    '--mantine-color-dimmed': '#5c6670', // secondary text: 5.9:1 on white
    '--mantine-color-error': ACCESSIBLE_TEXT.red,
    '--mantine-color-placeholder': '#6b7480'
  };
  for (const [color, text] of Object.entries(ACCESSIBLE_TEXT)) {
    light[`--mantine-color-${color}-text`] = text;        // <Text c="red">
    light[`--mantine-color-${color}-light-color`] = text; // text on light badges, light buttons, active nav links
    light[`--mantine-color-${color}-outline`] = text;     // outline buttons and badges
    if (color !== 'bank') {                               // bank-7 is already dark enough behind white text
      light[`--mantine-color-${color}-filled`] = text;    // filled buttons and badges (white text on top)
      light[`--mantine-color-${color}-filled-hover`] = text;
    }
  }
  return { variables: {}, light, dark: {} };
};
