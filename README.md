# EMP Payroll

**Open-source payroll management system — part of the [EmpCloud](https://empcloud.com) HRMS ecosystem.**

India-first payroll engine with PF, ESI, TDS, and Professional Tax built in. Designed to be the open-source alternative to Zoho Payroll, Keka, and Razorpay Payroll.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

## Features

### Payroll Engine
- **Salary Structure Builder** — CTC breakdown with configurable components (Basic, HRA, SA, LTA)
- **Payroll Processing** — Draft > Compute > Approve > Pay workflow with full audit trail
- **Payslip PDF** — Printable payslip with company header, earnings/deductions, net pay
- **Bank Transfer File** — NEFT/RTGS CSV for direct salary credit
- **Payroll Analytics** — Cost trends, month-over-month comparison, headcount charts

### India Compliance (FY 2025-26)
- **Income Tax** — Old & New regime TDS, Sec 87A rebate, marginal relief, surcharge, 4% cess
- **Provident Fund** — 12% EPF, EPS, admin/EDLI charges, PF ECR generation
- **ESI** — 0.75% employee + 3.25% employer (gross <= 21,000)
- **Professional Tax** — Karnataka, Maharashtra, Tamil Nadu, Telangana, West Bengal, Gujarat, Delhi
- **Form 16** — Part A (TDS certificate) + Part B (salary & tax computation)
- **Statutory Reports** — PF ECR, ESI return, PT return, TDS summary

### Employee Management
- **Employee CRUD** — Add, edit, deactivate with full profile
- **Salary Assignment** — Assign structures, revise CTC with auto-calculated breakdown
- **Tax Declarations** — Submit 80C/80D/NPS declarations with approval workflow
- **CSV Import/Export** — Bulk employee import, CSV export
- **Leave Balances** — Earned/casual/sick leave tracking per employee
- **Reimbursements** — Submit, approve, reject, pay expense claims
- **Department Filters** — Quick filter employees by department

### Employee Self-Service Portal
- **Dashboard** — CTC, latest payslip, tax regime, days at company
- **My Payslips** — View history, expandable details, PDF download
- **My Salary** — CTC breakdown with pie chart
- **My Tax** — Tax computation, TDS tracker with progress bar, Form 16 download
- **Declarations** — Submit investment proofs (80C, 80D, NPS, HRA)
- **Reimbursements** — Submit expense claims, track status
- **Change Password** — Self-service password change

### UI & UX
- **Dark Mode** — Light / Dark / System with persistent toggle
- **Command Palette** — Ctrl+K to search pages, employees, actions
- **Global Search** — Debounced employee search in top bar
- **Notifications** — Bell dropdown with contextual alerts
- **Breadcrumbs** — Auto-generated navigation trail
- **Pagination** — Client-side with page numbers on all tables
- **Mobile Responsive** — Hamburger menu, adaptive layouts
- **Error Boundary** — Graceful error handling with recovery
- **Loading Skeletons** — Shimmer states for all pages
- **Keyboard Shortcuts** — Press ? for help

### Infrastructure
- **Docker Compose** — One-command dev setup (MySQL + Redis + API + Client)
- **Production Docker** — Multi-stage builds, nginx reverse proxy, gzip
- **API Rate Limiting** — Auth: 20/15min, API: 100/min
- **Swagger Docs** — Interactive API docs at /api/v1/docs
- **CI/CD** — GitHub Actions with type-check + tests + build
- **Multi-DB** — MySQL, PostgreSQL, or MongoDB via env var

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS + React Query |
| Backend | Node.js + Express 5 + TypeScript |
| Database | MySQL 8 (default) / PostgreSQL / MongoDB |
| Cache | Redis 7 |
| Auth | JWT (access + refresh tokens) + bcrypt |
| Validation | Zod (server-side) |
| Charts | Recharts |
| Email | Nodemailer (SMTP) |
| Testing | Vitest (18 unit tests) |

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/EmpCloud/emp-payroll.git
cd emp-payroll
docker compose up -d --build
```

Wait ~30 seconds, then:
- **Frontend**: http://localhost:5175
- **API**: http://localhost:4000
- **API Docs**: http://localhost:4000/api/v1/docs

Seed demo data:
```bash
docker exec emp-payroll-server pnpm --filter @emp-payroll/server exec tsx src/db/seed.ts
```

Login: `ananya@technova.in` / `Welcome@123`

### Option 2: Local Development

**Prerequisites:** Node.js >= 20, pnpm, MySQL 8+

```bash
git clone https://github.com/EmpCloud/emp-payroll.git
cd emp-payroll
pnpm install

# Copy and edit env
cp packages/server/.env.example packages/server/.env

# Run migrations + seed
pnpm --filter @emp-payroll/server exec tsx src/db/migrate.ts
pnpm --filter @emp-payroll/server exec tsx src/db/seed.ts

# Start dev servers
pnpm --filter @emp-payroll/server dev    # API on :4000
pnpm --filter @emp-payroll/client dev    # UI on :5173
```

### Option 3: Production Deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Serves on port 80 with nginx reverse proxy.

---

## Project Structure

```
emp-payroll/
├── packages/
│   ├── shared/                 # Shared types, tax constants, validators
│   ├── server/                 # Express API (85+ endpoints)
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── routes/     # 11 route modules
│   │   │   │   ├── middleware/ # Auth, rate-limit, error handling
│   │   │   │   ├── validators/ # Zod request schemas
│   │   │   │   └── docs.ts    # Swagger/OpenAPI spec
│   │   │   ├── services/       # Business logic
│   │   │   │   ├── payroll, tax, compliance, employee, salary
│   │   │   │   ├── auth, attendance, org, payslip, export
│   │   │   │   ├── reimbursement, leave, audit, email
│   │   │   │   ├── reports, bank-file, form16, payslip-pdf
│   │   │   │   └── tax/ (india, us, uk engines)
│   │   │   └── db/            # Adapters, migrations, seeds
│   │   └── tests/unit/        # Vitest (18 tests)
│   └── client/                 # React SPA (30 pages)
│       └── src/
│           ├── api/            # Axios client, hooks, auth helpers
│           ├── components/     # 20+ reusable UI components
│           ├── pages/          # 30 lazy-loaded page components
│           ├── lib/            # Utils, theme provider
│           └── styles/         # Tailwind + dark mode CSS
├── docker/                     # Dockerfiles (dev + prod), nginx.conf
├── docker-compose.yml          # Development setup
├── docker-compose.prod.yml     # Production setup
└── .github/workflows/ci.yml   # CI pipeline
```

---

## API Endpoints (85+)

| Module | Base Path | Key Endpoints |
|--------|-----------|---------------|
| Auth | `/api/v1/auth` | login, register, refresh, change-password |
| Employees | `/api/v1/employees` | CRUD, bank/tax/PF details, import, export CSV |
| Salary | `/api/v1/salary-structures` | CRUD, components, assign, revise |
| Payroll | `/api/v1/payroll` | create, compute, approve, pay, cancel, reports |
| Payslips | `/api/v1/payslips` | list, PDF, export CSV, dispute |
| Tax | `/api/v1/tax` | computation, declarations, regime, Form 16 |
| Attendance | `/api/v1/attendance` | summary, bulk, import CSV, LOP override |
| Leaves | `/api/v1/leaves` | balances, record, adjust |
| Reimbursements | `/api/v1/reimbursements` | list, approve, reject, pay |
| Organizations | `/api/v1/organizations` | CRUD, settings, activity log |
| Self-Service | `/api/v1/self-service` | dashboard, payslips, salary, tax, profile |
| Docs | `/api/v1/docs` | Swagger UI |

---

## Frontend Pages (30)

**Admin Dashboard**: Dashboard, Employees (list/create/detail), Salary Structures, Payroll Runs, Payroll Run Detail, Payroll Analytics, Payslips, Tax Overview, Attendance, Leaves, Reimbursements, Holidays, Reports, Audit Log, Settings

**Self-Service Portal**: Dashboard, My Payslips, My Salary, My Tax, Declarations, Reimbursements, Profile

**Other**: Login, Onboarding Wizard, 404 Page

---

## Demo Data

The seed creates:
- **Organization**: TechNova Solutions Pvt. Ltd. (Bengaluru, KA)
- **10 Employees**: Ananya (HR Admin), Rahul, Priya, Vikram, Sneha, Arjun, Meera, Karthik, Divya, Aditya
- **Salary Structure**: Standard CTC with Basic (40%), HRA (50% of Basic), SA
- **Payroll Run**: Last month, fully paid with 10 payslips
- **Attendance**: 3 months of records for all employees

Login as `ananya@technova.in` / `Welcome@123` (HR Admin)

---

## Running Tests

```bash
cd packages/server
pnpm test
```

18 unit tests covering:
- PF computation (wage ceiling, VPF, DA)
- ESI eligibility and rates
- Professional Tax per state
- Income Tax (old/new regime, 80C, HRA, rebate, cess)

---

## Environment Variables

See `packages/server/.env.example` for all options. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PROVIDER` | `mysql` | Database: mysql, postgres, mongodb |
| `DB_HOST` | `localhost` | Database host |
| `JWT_SECRET` | `change-this` | JWT signing secret |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `PAYROLL_COUNTRY` | `IN` | Country for tax rules |

---

## License

[GPL-3.0](./LICENSE) — Free to use, modify, and distribute.

---

**Built with care by the [EmpCloud](https://empcloud.com) team**
