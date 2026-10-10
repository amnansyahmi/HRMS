# Nonymauz People design

One teal accent identifies actions and selection. Warm surfaces and charcoal text keep HR information readable. A restrained teal, blue, amber and violet palette gives dashboard categories distinct surfaces. Status badges retain their own semantic labels.

| Token                   | Light     | Dark      | Use                                                            |
| ----------------------- | --------- | --------- | -------------------------------------------------------------- |
| `--primary` / `--brand` | `#14665B` | `#8DD4C3` | Primary buttons, selected controls, progress and key SVG icons |
| `--primary-foreground`  | `#FFFFFF` | `#142C26` | Text on primary fills                                          |
| `--brand-soft`          | `#E2EFEB` | `#263F36` | Selected navigation and icon surfaces                          |
| `--background`          | `#FDFDFB` | `#17201F` | App background                                                 |
| `--canvas`              | `#F3F5F3` | `#17201F` | Dashboard canvas                                               |
| `--card`                | `#FFFFFF` | `#202B29` | Widget and dialog surfaces                                     |
| `--foreground`          | `#202B2A` | `#EDF3F0` | Main text                                                      |
| `--muted-foreground`    | `#5F6B68` | `#AFBEB7` | Supporting text                                                |
| `--border`              | `#DCE3DF` | `#3B4A44` | Dividers and card outlines                                     |

Colors live in `src/app/globals.css` and feed the existing shadcn/ui components. Dark mode follows the device preference. Green means approved/active, amber means pending/attention, red means rejected/error and blue marks informational events. Use text labels as well as color.

Widgets use a two-column desktop layout and one column on phones, with 12px panel corners, 16–24px spacing and visible keyboard focus. The seven-day agenda compresses across the phone width; primary controls and the bottom navigation retain at least 44px touch height. Navigation respects safe areas and clears the chat keyboard. Use Lucide SVG icons with accessible names on icon-only buttons.

Avoid decorative gradients, fake trend percentages, unrelated accent colors outside the dashboard palette, emoji icons and private data in browser preference storage. Widget data comes from the authenticated workspace; display counts with their scope and retain the server's normal approval and clock validation flows.

Dashboard summary cards use solid pale teal (`#DDEFE9`), blue (`#E1ECFA`), amber (`#F9EACB`) and violet (`#EDE4F7`) surfaces with dark matching text. The workday card uses deep teal (`#14665B`) and white text. Dark mode uses muted category surfaces and lighter text; the workday card keeps its deep teal fill. Chart bars highlight today; doughnut segments share the category palette and always include labeled counts. No attendance rate or trend is inferred from missing schedules. Charts use the server-authorized, currently loaded records; workdays deduplicate clock sessions per person and date.
