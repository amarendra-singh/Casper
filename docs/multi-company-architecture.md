# Multi-Company Architecture — Design Doc

Status: **Draft for review** · Author: Claude (senior full-stack) · Date: 2026-07-22

## 1. Problem

Casper presents a multi-company experience in the UI (company switcher, "Per
company" toggle, "Add new company") but **none of it is real**:

- `COMPANIES` in `Layout.jsx` is a hardcoded array of 3 fake companies.
- There is **no `Company` model** in the backend and **no `company_id`** on any
  entity. Switching companies changes nothing.
- There is **no registration** endpoint — only login for a seeded admin.

So the app is single-tenant in the data layer. Every feature built so far
(dashboard, SKUs, pricing, P&L, the new Users page, the calculator) ignores the
project's core idea: **one owner running several companies, each with its own
catalog, pricing, P&L and team.**

## 2. Product model (confirmed)

- **One owner → many companies.** A person signs up, then creates and owns one
  or more companies. They switch between their companies. All data (SKUs,
  pricing, P&L, fraud, vendors, settings…) is scoped to the **active company**.
- **Team members are invited per company** with a role (admin / viewer) that
  applies only inside that company. The owner is the company's super-admin.
- **Modules:** every company has all modules by default, data-scoped; **and**
  each company can enable/disable modules it doesn't use (both behaviours).

## 3. Goals / non-goals

**Goals**
- Real tenant isolation: a user can only ever read/write data of companies they
  belong to, scoped to the one they're acting in.
- Self-service registration + company creation + onboarding.
- Per-company roles (RBAC) and per-company module enablement.
- Make the existing switcher, "Per company" toggle and "Add company" real.

**Non-goals (v1)**
- Billing / subscriptions per company.
- Cross-company consolidated reporting beyond the existing "Per company" toggle.
- SSO / external identity providers.

## 4. Data model

### New tables

```
Company
  id, name, slug, color, owner_id → users.id, created_at

CompanyMembership              # who can access a company, and as what
  id, company_id → companies.id, user_id → users.id,
  role ENUM(owner, admin, viewer), created_at
  UNIQUE(company_id, user_id)

CompanyModule                 # per-company module enable/disable
  id, company_id → companies.id, module_key STR, enabled BOOL
  UNIQUE(company_id, module_key)
  # module_key ∈ {skus, pricing, pnl, fraud, calculator, users, settings}
```

### `company_id` added to every tenant-scoped entity

Scoped (get a non-null `company_id` FK, indexed):
`Sku`, `SkuPricing`, `Platform` (carries per-seller economics — cr_charge,
ad%, profit%, targets), `Vendor`, `Category`, `MiscItem`, `PnlReport`,
`PnlSkuRow` (via report), `ActorRiskProfile`, `ReturnReasonCluster`,
`GlobalSettings` (becomes per-company), and **custom** `HsnCode` rows.

Global / shared (no `company_id`):
`User` (a global identity — one login, many companies), **standard** `HsnCode`
reference rows.

**Open decision (flag):** `Platform` — I propose per-company (each company
configures its own marketplace economics). Alternative: a global platform list
+ a per-company `PlatformConfig`. Per-company is simpler; confirm.

## 5. Tenancy enforcement (the core mechanism)

- The frontend stores the **active company id** and sends it on every request
  as an `X-Company-Id` header (axios interceptor).
- A backend dependency `get_active_company(user, header) -> Company`:
  1. looks up the `CompanyMembership` for `(user, X-Company-Id)`;
  2. 403 if the user isn't a member;
  3. returns the company + the user's role in it.
- Every scoped query/route filters `WHERE company_id = active.id`, and every
  create sets `company_id = active.id`. Reads and writes are impossible outside
  the caller's membership — isolation is enforced server-side, never trusted
  from the client.

This replaces today's global `require_any/require_admin_or_above` with
company-scoped equivalents (`require_company_role(...)`).

## 6. Auth: registration, login, switching

- **`POST /auth/register`** (new, public): name, email, password → creates the
  `User`, their **first `Company`**, an `owner` membership, and default enabled
  modules. Returns tokens + the company. This is the onboarding entry point.
- **Login** unchanged, but the response also returns the user's companies so
  the frontend can pick an active one.
- **`GET /companies`** — companies the user belongs to. **`POST /companies`** —
  create another (owner). **`POST /companies/{id}/switch`** is not needed;
  switching is purely client-side (change the header) + a `GET /me/context`
  that returns role + enabled modules for the active company.
- **`GET /companies/{id}/members`**, **`POST .../members`** (invite by email),
  **`PATCH/DELETE .../members/{uid}`** — this is what the current global Users
  page **should become**: per-company team management.

## 7. RBAC per company

Role lives on `CompanyMembership`, not on `User`. `owner` > `admin` > `viewer`,
enforced by `require_company_role`. The platform has no global super-admin in
the product sense (the seeded admin becomes an owner of the seed company).

## 8. Modules per company

- On company creation, all modules are enabled by default.
- `GET /me/context` returns `{ role, modules: {skus:true, fraud:false, …} }`.
- The frontend nav renders only enabled modules; hitting a disabled module's
  route shows an "enable this module" state. A company Settings screen toggles
  modules (owner only) → `PATCH /companies/{id}/modules`.

## 9. Frontend changes

- **Registration + onboarding** pages (new): sign up → create first company.
- **Company switcher** (`Layout.jsx`): replace `COMPANIES` constant with
  `GET /companies`; selecting one sets the active-company header + refetches.
- **"Add new company"**: real create flow.
- **Users page → "Team"** under the active company: invite/manage members with
  per-company roles (reuses most of what I already built, re-scoped).
- **Nav**: driven by enabled modules; grouped to match the company workspace.
- **"Per company" dashboard toggle**: real — aggregate across the owner's
  companies vs the single active one.
- Axios interceptor adds `X-Company-Id`; a React context holds active company +
  role + modules.

## 10. Migration & backfill

1. Create `companies`, `company_memberships`, `company_modules` tables.
2. Insert a default company ("Shringar House Jewellery"); make the seeded admin
   its `owner`; enable all modules.
3. Add nullable `company_id` to each scoped table; backfill all existing rows to
   the default company; then set `NOT NULL` + index.
4. Alembic migration per step; reversible.

## 11. Phased rollout (each phase shippable + tested)

1. **Foundation**: models + migration + `get_active_company` + register/login/
   companies endpoints. Backfill. (backend only, tests)
2. **Scope the data**: add `company_id` filtering to every existing route +
   service. Verify isolation with tests (user A can't see company B's data).
3. **Frontend tenancy**: active-company context, real switcher, header
   interceptor, registration/onboarding pages.
4. **Team management**: convert Users → per-company members + invites.
5. **Modules**: enablement model + nav gating + company settings toggles.

## 12. Open questions for you

1. **Platform scoping** — per-company (my recommendation) or global list + per-
   company config?
2. **Invites** — email-based invite links, or owner sets a temp password (like
   the current Users page)? (Email needs an SMTP integration we don't have yet.)
3. **Registration** — open self-signup, or invite-only for new owners?
4. Should the **calculator** be company-scoped at all (it's stateless math), or
   stay a global tool available in every company?
