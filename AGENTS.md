# Repository Guidelines

## Project Structure & Module Organization

ShopLedger is a legacy Node.js/Express application. `server.js` wires middleware, API routers, static files, and the printable invoice endpoint. Keep HTTP concerns in `routes/`; place billing, inventory, ledger, order, tax, and reporting rules in `lib/`. The browser client is plain HTML, CSS, and JavaScript under `public/`. `data/db.json` is the file-backed development database, while `config.js` contains shop, tax, coupon, and server defaults. Characterization tests live in `test/`; architecture material belongs in `docs/`.

## Build, Test, and Development Commands

- `npm ci` installs the locked Express and body-parser dependencies.
- `npm start` runs the server at `http://localhost:3000` (override with `PORT=4000 npm start`).
- `node --test test/*.test.js` runs the Node built-in characterization suite.

There is no compilation step. Do not use `npm test`: its current package script is an unconfigured placeholder.

## Coding Style & Naming Conventions

Match the existing ES5-style CommonJS code: two-space indentation, semicolons, single quotes, `var`, and `require`/`module.exports`. Use camelCase for variables and functions, lowercase descriptive module names (for example, `lib/pricing.js`), and REST-style plural route paths such as `/api/orders`. Keep calculations pure where possible and round monetary values through existing helpers. No formatter or linter is configured, so avoid unrelated reformatting.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name files `*.test.js` and write behavior-focused test names. Add coverage near the affected domain logic, especially for GST slabs, coupon caps, rounding, inventory reservation, cancellations, and khata balances. Tests labeled `CURRENT BEHAVIOUR` document known legacy inconsistencies; do not “fix” them accidentally without updating the intended behavior and related assertions. Run the full suite before submitting changes.

## Commit & Pull Request Guidelines

History uses short, lowercase, imperative or feature-summary subjects, such as `support hsn gst slabs and coupon maxDiscount caps`. Keep each commit focused. Pull requests should explain the user-visible change, affected routes/modules, test evidence, and any `data/db.json` or configuration impact. Link the relevant issue and include screenshots for dashboard or invoice UI changes.

## Security & Data Safety

Treat `data/db.json` as mutable application state; use a disposable copy for manual testing and avoid committing incidental order changes. Never add real customer data or credentials. The legacy `adminKey` in `config.js` is development-only and must not be reused in production.
