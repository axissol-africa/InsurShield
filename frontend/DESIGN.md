# Design

## Source of truth

Status: Active · 17 September 2026. Product surfaces: customer motor-insurance journey, customer account, staff portals, inspection hand-off. Evidence reviewed: supplied desktop/mobile references, current React pages, and `src/index.css` tokens.

## Brand

InsurShield is a trusted, clear Zambian motor-insurance aggregator. Use the established red primary palette with white and warm-neutral surfaces. Avoid green, blue, purple, gradients, and decorative effects as product-state colours.

## Product goals

Help customers compare, buy, renew and retrieve motor-insurance documents with clear, low-friction steps. Do not imply insurer decisions or live integrations that are not available in the prototype.

## Personas and jobs

Customers compare and purchase cover across desktop and PWA mobile. Insurer and admin staff manage requests and policies.

## Information architecture

Customer journey: coverage, vehicle identification, vehicle use, quote request, comparison, payment, confirmation, account. Documents belong to the issued policy in confirmation and account.

## Design principles

Use direct language, visible totals, and consistent card/form layouts. A status should remain understandable through copy and iconography, not colour alone.

## Visual language

Primary: `#dc2626`; primary container: `#fee2e2`; text: `#111827`; surfaces: white and slate/neutral. Positive or completed states use the red palette and explicit labels such as “Active”, “Available”, or “Complete”; no green state palette. Inter is the UI typeface. Use rounded cards, restrained shadows, and short functional motion only.

## Components

Reuse current buttons, cards, inputs, JourneyProgress, and document actions. Status badges use primary-container backgrounds and primary text; neutral pending states use slate.

## Accessibility

Use semantic controls, labels, keyboard-focus styles, sufficient contrast, and text labels alongside icons and colour.

## Responsive behavior

Support desktop, intermediate widths, and mobile/PWA. Cards stack on narrow displays and actions retain touch-friendly heights.

## Interaction states

Loading, success, errors, selected controls, disabled inputs, empty lists, and document availability must use the same red/neutral palette.

## Content voice

Plain, reassuring, concise language. State exactly what is included in a payment and what a document action does.

## Implementation constraints

React 19, Tailwind v4, existing theme tokens, no new UI dependency. Verify with lint and production build.

## Open questions

- [ ] Confirm final RTSA fee and digital-disc integration rules when a backend is available. Owner: product/RTSA integration. Impact: payment and document generation.
