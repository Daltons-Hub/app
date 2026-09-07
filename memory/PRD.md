# HotShot Ops — PRD

## Original Problem Statement
Mobile-first web app for hotshot trucking operators (diesel pickups pulling gooseneck/flatbed trailers). Usable by non-technical employees with zero training. Balanced model tier. Built in strict phased order, confirming each phase before the next.

## Architecture
- **Frontend**: React (CRA/craco), react-router, TailwindCSS, shadcn/ui, lucide-react, sonner. Mobile-first (max-w-md shell), rugged dark tactical theme (obsidian + amber), work-glove touch targets (min 52px).
- **Backend**: FastAPI + Motor (MongoDB async). All routes under `/api`.
- **Auth**: Username + 4-digit PIN, bcrypt hashing, JWT (Bearer token in localStorage `hs_token`). Two roles: `owner`, `driver`. `require_owner` gate (403).
- **Storage**: Emergent object storage for document files (photos/PDFs). DB is source of truth (`files` collection, soft-delete).

## User Personas
- **Owner/Admin**: sees everything incl. financials (later phases), manages rigs, documents, drivers.
- **Driver/Employee**: sees only assigned rig, document vault (read-only), weigh station mode, dashboard. No financial data, no drivers tab.

## Core Requirements (static)
Phase 1 Core → Phase 2 Trip logic → Phase 3 Back office → Phase 4 AI Assistant. Do not add features beyond the spec.

## Implemented (with dates)
### Phase 1 — Core ✅ (2026-06, tested 16/16 backend + frontend flows)
- Username/PIN login, two roles, role-gated UI + API.
- Rig Profiles: full truck+trailer CRUD (make/model, engine, empty/axle weights, GVWR, GCWR, trailer type/length/capacity).
- Document Vault: upload photo/PDF to object storage, expiration dates, ACTIVE/EXPIRING(≤30d)/EXPIRED badges, category tabs (DOT, MC, Insurance, IFTA, Medical, Permit).
- Weigh Station Mode: one-tap full-screen showing DOT#, MC#, insurance, IFTA status + rig axle limits; GOOD TO GO vs CHECK PAPERWORK banner.
- Dashboard: guided next-step card + quick stats.
- Drivers management (owner): create driver login, assign rig.

## Backlog (prioritized)
### Phase 2 — Trip logic ✅ (2026-06, tested 11/11 + 16/16 Phase 1 regression)
- Load Compliance Calculator: cargo + rig → FMCSA requirements (USDOT, medical, HOS/ELD, CDL Class A/B, drug & alcohol consortium) using max(GCWR rating, actual loaded weight) against 10,001 & 26,001 lb thresholds; rating-gotcha note + overweight warnings.
- Load Rate Calculator (owner-only): fuel/DEF/wear, cost-per-mile, profit & margin vs quoted rate.
- Load Securement Checklist: chains vs straps, 50% aggregate-WLL rule, length-based min tie-down count, editable pre-trip checklist.
- Trip logging: start/stop, duty status, mileage by state, total miles, trip history.
- Active-rig picker (owner) powers Weigh Station; sample data (Big Blue rig + 5 docs + demo driver assigned) via one-time seed flag.
### Phase 3 — Back office ✅ (2026-06, tested 13/13 + 27/27 regression)
- Delivery/POD (owner): capture customer/load/rate + POD photo + drawn signature → auto-generated invoice (atomic sequential INV-YYYY-####), view invoice with photo/signature, toggle Paid/Unpaid, delete.
- Maintenance Tracker (owner): per-rig service items (oil/DEF/tires/DOT inspection) by mileage and/or days; editable + trip-synced odometer; OK/DUE SOON/OVERDUE status; Mark Serviced.
- Expenses + IFTA (owner): categorized Fuel/Toll/Repair/DEF/Other (fuel captures gallons + state); IFTA report aggregates completed-trip mileage-by-state + fuel gallons-by-state → per-state table w/ total miles, gallons, fleet MPG.
- Owner nav adds an 'Office' hub; all Phase 3 routes owner-only (driver gets 403, no Office nav).
### Phase 4 — AI Assistant (P0, next — only if credits remain)
- Gemini 3 Flash chat over stored app data (compliance, margin, maintenance questions).

## Notes / Known minor items
- Owner weigh-station currently uses first rig (no active-rig selector yet).
- Optional a11y: add DialogDescription to modals.
