// Amazon/Alexa shopping list integration via unofficial cookie-based API.
// Cookie capture: node scripts/alexa-setup.js
// Cookie refresh: /api/alexa/refresh (manual) or Vercel cron (if auto-refresh is on)
export { addToAlexaList as addToAlexaShoppingList } from './alexa-lists';
