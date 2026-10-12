import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// jsdom has no media queries. Components that ask for the screen width get a
// query that never matches and read `window.innerWidth`, which a test can set.
window.matchMedia ??= () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })

// jsdom has no ResizeObserver. Radix controls that measure themselves (switch,
// radio) only need one that exists.
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
