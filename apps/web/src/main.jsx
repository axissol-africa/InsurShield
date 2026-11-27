import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/app/App.jsx'

// Reveal icons once their font is in (or after a short grace period if loading fails).
const revealIcons = () => document.documentElement.classList.add('icons-ready');
document.fonts.load("24px 'Material Symbols Outlined'").then(revealIcons, revealIcons);
setTimeout(revealIcons, 3000);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
