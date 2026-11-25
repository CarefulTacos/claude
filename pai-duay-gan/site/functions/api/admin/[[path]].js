import { fail, handleError } from '../../_lib/http.js';
import * as B from '../../_lib/admin-bookings.js';
import * as O from '../../_lib/admin-other.js';

// Tiny router for /api/admin/*. Patterns use :id for a numeric segment.
const routes = [
  ['POST', 'login', O.login],
  ['POST', 'logout', O.logout],
  ['GET', 'session', O.session],
  ['GET', 'dashboard', O.dashboard],
  ['GET', 'bookings', B.list],
  ['GET', 'bookings/:id', B.get],
  ['PATCH', 'bookings/:id', B.patch],
  ['GET', 'bookings/:id/cancel-preview', B.cancelPreview],
  ['POST', 'bookings/:id/promo', B.applyPromo],
  ['GET', 'assistants', O.listAssistants],
  ['POST', 'assistants', O.saveAssistant],
  ['PATCH', 'assistants/:id', O.saveAssistant],
  ['DELETE', 'assistants/:id', O.deleteAssistant],
  ['GET', 'payouts', O.payouts],
  ['POST', 'payouts/mark', O.markPayout],
  ['GET', 'customers', O.customers],
  ['GET', 'expenses', O.listExpenses],
  ['POST', 'expenses', O.saveExpense],
  ['PATCH', 'expenses/:id', O.saveExpense],
  ['DELETE', 'expenses/:id', O.deleteExpense],
  ['GET', 'reports', O.reports],
  ['GET', 'export/:type', O.exportCsv],
  ['GET', 'settings', O.getSettings],
  ['PUT', 'settings', O.putSettings],
  ['GET', 'pdpa', O.pdpaPreview],
  ['POST', 'pdpa/anonymize', O.pdpaAnonymize],
];

function match(pattern, parts) {
  const p = pattern.split('/');
  if (p.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === ':id') {
      if (!/^\d{1,9}$/.test(parts[i])) return null;
      params.id = Number(parts[i]);
    } else if (p[i] === ':type') {
      params.type = parts[i];
    } else if (p[i] !== parts[i]) return null;
  }
  return params;
}

export async function onRequest(context) {
  const raw = context.params.path;
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  const method = context.request.method.toUpperCase();
  let pathMatched = false;
  for (const [m, pattern, handler] of routes) {
    const params = match(pattern, parts);
    if (!params) continue;
    pathMatched = true;
    if (m !== method) continue;
    try {
      return await handler({ ...context, params, url: new URL(context.request.url) });
    } catch (err) {
      return handleError(err);
    }
  }
  return pathMatched ? fail(405, 'Method not allowed') : fail(404, 'ไม่พบ');
}
