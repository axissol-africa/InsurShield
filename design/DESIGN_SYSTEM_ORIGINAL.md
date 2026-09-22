---
name: Maroon & Gold Insurance Aggregator
colors:
  surface: '#fff8f6'
  surface-dim: '#eed4d0'
  surface-bright: '#fff8f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff0ee'
  surface-container: '#ffe9e6'
  surface-container-high: '#fde2de'
  surface-container-highest: '#f7ddd8'
  on-surface: '#261816'
  on-surface-variant: '#5a413d'
  inverse-surface: '#3d2d2a'
  inverse-on-surface: '#ffedea'
  outline: '#8e706c'
  outline-variant: '#e2bfb9'
  surface-tint: '#b22b1d'
  primary: '#570000'
  on-primary: '#ffffff'
  primary-container: '#800000'
  on-primary-container: '#ff8371'
  inverse-primary: '#ffb4a8'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#00137f'
  on-tertiary: '#ffffff'
  tertiary-container: '#0021b9'
  on-tertiary-container: '#94a0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad4'
  primary-fixed-dim: '#ffb4a8'
  on-primary-fixed: '#410000'
  on-primary-fixed-variant: '#8f0f07'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#dfe0ff'
  tertiary-fixed-dim: '#bcc2ff'
  on-tertiary-fixed: '#000c61'
  on-tertiary-fixed-variant: '#1830c2'
  background: '#fff8f6'
  on-background: '#261816'
  surface-variant: '#f7ddd8'
typography:
  h1:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  h3:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: '0'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
  button:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  gutter: 16px
  sidebar_width: 260px
  topbar_height: 64px
---

## Brand & Style

The design system is built to convey authority, reliability, and modern efficiency. It targets a demographic that values both the speed of a digital-first experience and the prestige associated with traditional financial institutions. By combining a rich maroon palette with high-end gold accents, the UI bridges the gap between "InsurTech" agility and "Private Banking" exclusivity.

The chosen style is **Corporate / Modern** with a strong emphasis on **Minimalism**. The interface prioritizes clarity and whitespace to reduce the cognitive load inherent in comparing complex insurance products. A mobile-first approach ensures that information density is carefully managed, using card-based containers to modularize data and touch-friendly targets for all interactive elements.

## Colors

The color palette is anchored by a vibrant Maroon, used for primary actions and brand identifiers to evoke confidence. Secondary Black provides high-contrast grounding for text and structural navigation. 

- **Primary Maroon:** Used for primary CTAs, progress bars, and active states.
- **Secondary Black:** Applied to headers, navigation backgrounds, and primary text.
- **Premium Gold:** Reserved for "Pro" tiers, high-value coverage badges, and "Recommended" product highlights.
- **Soft Blue:** Utilized for tooltips, info banners, and helper text backgrounds to differentiate neutral information from brand actions.
- **Neutrals:** A range of cool grays provides separation between the white background and card surfaces.

## Typography

This design system utilizes **Inter** for all text levels to ensure maximum readability across mobile and desktop displays. Inter’s tall x-height and neutral character make it ideal for data-heavy insurance tables and comparison screens.

Headlines use a tighter letter-spacing and heavier weights to command attention, while body text maintains a generous line height for legibility during long-form policy reviews. All labels for form inputs and small captions use the "label-caps" style to provide a clear visual distinction from standard body content.

## Layout & Spacing

The design system employs a **Fluid Grid** model with a mobile-first philosophy. On mobile devices, a single-column layout is used with 16px side margins. On desktop, the system expands to a 12-column grid.

- **Dashboard Layout:** A fixed 260px sidebar for primary navigation, paired with a 64px topbar for search, notifications, and profile management.
- **Rhythm:** An 8px linear scale (with a 4px half-step for tight components) governs all padding and margins to ensure mathematical consistency.
- **Comparison Views:** Specific horizontal scrolling patterns are permitted for product comparison tables on mobile to keep information density high without breaking the layout.

## Elevation & Depth

Visual hierarchy is established through **Ambient Shadows** and tonal layering. The design system avoids heavy gradients, opting instead for subtle depth cues that suggest interactivity.

- **Level 0 (Background):** Pure White (#FFFFFF).
- **Level 1 (Cards/Sidebar):** White surface with a "soft shadow" (0 4px 6px -1px rgb(0 0 0 / 0.1)). This is the primary container for insurance product details.
- **Level 2 (Dropdowns/Modals):** A deeper shadow (0 10px 15px -3px rgb(0 0 0 / 0.1)) to indicate the element is physically above the card layer.
- **Tonal Layering:** The sidebar uses a very subtle light gray (#F9F9F9) to distinguish navigation from the main content area without needing a harsh border.

## Shapes

The shape language is **Rounded**, striking a balance between the friendliness of consumer apps and the structure of professional tools. 

- **Standard Elements:** Buttons, input fields, and small cards use a 0.5rem (8px) corner radius.
- **Large Containers:** Policy overview cards and modal windows use 1rem (16px) to emphasize their role as primary content buckets.
- **Form Elements:** Checkboxes use a 4px radius, while radio buttons remain circular to maintain standard UI conventions.

## Components

- **Cards:** The core of the aggregator. Each card must have a clear "Primary" badge for the price/premium and a "Secondary" section for policy features. Use the Gold accent for "Best Value" or "Top Rated" card variations.
- **Buttons:** 
    - *Primary:* Solid Maroon with White text.
    - *Secondary:* Outlined Maroon or Solid Black for utility actions.
    - *Ghost:* No border, Maroon text for low-priority actions.
- **Inputs:** Clean, 1px Gray borders that shift to 2px Maroon on focus. Labels are always visible above the field in "label-caps" style.
- **Chips:** Used for policy tags (e.g., "Full Coverage," "No Deductible"). Use Soft Blue background with Dark Blue text for standard tags, and Gold background for premium features.
- **Dashboard Sidebar:** Icon-driven with Maroon indicators for the active state. High contrast between Black text and the light sidebar background.
- **Comparison Toggle:** A pill-shaped switch used to compare up to 3 insurance products simultaneously.