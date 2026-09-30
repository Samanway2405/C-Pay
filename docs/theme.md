# App color themes

C-Pay follows the operating-system light or dark appearance setting. `ThemeProvider`
uses React Native's `useColorScheme` and supplies the active semantic palette to
navigation and every screen. Component styles are created through
`createThemedStyles`, so an appearance change is applied without restarting the app.

All app colors must be defined in `App/src/constants/theme.ts`. UI code should use
semantic tokens such as `background`, `surface`, `surfaceElevated`, `textPrimary`,
`textMuted`, and `border` instead of literal color values.

## Contrast verification

The core text pairs were checked using the WCAG 2.x relative-luminance formula.
Ratios are rounded down to two decimals.

| Theme | Foreground | Background | Ratio | WCAG AA normal text |
| --- | --- | --- | ---: | --- |
| Light | `textPrimary` (`#111827`) | `surface` (`#FFFFFF`) | 17.74:1 | Pass |
| Light | `textMuted` (`#475569`) | `surface` (`#FFFFFF`) | 7.58:1 | Pass |
| Light | `textPrimary` (`#111827`) | `background` (`#F6F8FB`) | 16.67:1 | Pass |
| Light | `textInverse` (`#FFFFFF`) | `primary` (`#2563EB`) | 5.17:1 | Pass |
| Dark | `textPrimary` (`#F8FAFC`) | `surface` (`#111827`) | 16.96:1 | Pass |
| Dark | `textMuted` (`#CBD5E1`) | `surface` (`#111827`) | 11.95:1 | Pass |
| Dark | `textPrimary` (`#F8FAFC`) | `background` (`#0B1120`) | 18.00:1 | Pass |
| Dark | `textInverse` (`#FFFFFF`) | `primaryDark` (`#2563EB`) | 5.17:1 | Pass |

Borders and disabled controls are not used as the sole carrier of readable text.
Camera and QR overlays deliberately use fixed white content on dark translucent
scrims, while QR payloads retain a fixed white `qrBackground` for scanner reliability.
