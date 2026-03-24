# EMP Payroll

**Open-source payroll management system — part of the [EmpCloud](https://empcloud.com) HRMS ecosystem.**

India-first payroll engine with PF, ESI, TDS, and Professional Tax built in. Multi-country tax support (India, US, UK). Designed to be the open-source alternative to Zoho Payroll, Keka, and Razorpay Payroll.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Tests](https://img.shields.io/badge/tests-67%20passing-brightgreen.svg)]()

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Testing](#testing)
- [Deployment](#deployment)
- [Demo Data](#demo-data)
- [Environment Variables](#environment-variables)
- [License](#license)

---

## Features

### Payroll Engine
- **Salary Structure Builder** — CTC breakdown with configurable components (Basic, HRA, SA, LTA, custom)
- **Payroll Processing** — Full lifecycle: Draft > Compute > Approve > Pay with audit trail
- **Payslip Generation** — Printable HTML payslips with company header, earnings/deductions, YTD
- **Bank Transfer File** — NEFT/RTGS CSV for direct salary credit
- **Payroll Analytics** — Cost trends, month-over-month comparison, headcount charts, department breakdown
- **Payroll Variance Alerts** — Automatic detection of zero net pay or high deduction ratios
- **Cost Breakdown Charts** — Pie chart (net/deductions/employer), department-wise cost split
- **Batch Email Payslips** — One-click email all payslips for a payroll run

### Multi-Country Tax Engines

#### India (FY 2025-26)
- **Income Tax** — Old & New regime TDS, Sec 87A rebate, marginal relief, surcharge, 4% cess
- **Provident Fund** — 12% EPF, EPS, admin/EDLI charges, PF ECR generation
- **ESI** — 0.75% employee + 3.25% employer (gross <= 21,000)
- **Professional Tax** — Karnataka, Maharashtra, Tamil Nadu, Telangana, West Bengal, Gujarat, Delhi
- **Form 16** — Part A (TDS certificate) + Part B (salary & tax computation)
- **Statutory Reports** — PF ECR, ESI return, PT return, TDS summary

#### United States
- **Federal Income Tax** — W-4 based withholding with bracket computation
- **FICA** — Social Security (6.2% up to wage base $176,100) + Medicare (1.45% + 0.9% additional)
- **State Tax** — 50-state support (flat/progressive rates, no-income-tax states)
- **FUTA** — Federal unemployment tax (employer-only)

#### United Kingdom
- **PAYE** — Income tax with cumulative/non-cumulative basis, all tax codes
- **National Insurance** — Employee (Category A/C) + Employer contributions
- **Student Loan** — Plan 1, 2, 4, 5 automatic deductions
- **Auto-Enrollment Pension** — Qualifying earnings, configurable rates
- **Scottish/Welsh Tax** — Regional tax band support

### Employee Management
- **Employee CRUD** — Full profile with personal, bank, tax, PF details
- **Salary Assignment** — Assign structures, revise CTC with auto-calculated breakdown
- **Employee Notes** — Categorized notes (general, performance, HR, finance) with author tracking
- **Employee Timeline** — Visual history showing join date, salary revisions, payslips
- **YTD Summary** — Year-to-date gross, deductions, net pay per employee
- **Employee Search** — Instant text search by name, email, code, or designation
- **Department Filters** — Quick filter employees by department
- **CSV Import/Export** — Bulk employee import, CSV export with full details
- **Org Chart** — Visual organizational hierarchy
- **Salary Revision History** — Track all past salary changes with effective dates

### Attendance & Leave
- **Attendance Summary** — Per-employee monthly summary (present, absent, LOP, overtime)
- **Bulk Attendance** — "Mark All Present" for quick monthly entry
- **Attendance Import** — CSV/API import for integration with biometric systems
- **LOP Override** — Manual override of loss-of-pay days
- **Leave Balances** — Earned/casual/sick/privilege leave tracking per financial year
- **Holiday Calendar** — Company-wide holiday management

### Loans & Reimbursements
- **Employee Loans** — Salary advance, emergency loan, personal loan with EMI tracking
- **Loan Payments** — Record payments, auto-calculate outstanding balance
- **Reimbursement Claims** — Submit, approve, reject, pay expense claims
- **Status Tracker** — Visual progress bar (pending > approved > paid)
- **Category-Based** — Medical, travel, food, equipment, internet, books, other

### Tax Declarations
- **Self-Service Declarations** — Employees submit 80C/80D/NPS/HRA proofs
- **Quick Declare Wizard** — Declare all sections in one go
- **Approval Workflow** — HR reviews and approves declarations
- **Form 16 Generation** — Downloadable Form 16 (Part A + Part B)

### Employee Self-Service Portal
- **Dashboard** — CTC, latest payslip, tax regime, days at company, quick links
- **My Payslips** — View history, expandable details, PDF download, dispute workflow
- **My Salary** — CTC breakdown with component-wise display
- **My Tax** — Tax computation, TDS tracker, Form 16 download
- **Declarations** — Submit investment proofs with bulk wizard
- **Reimbursements** — Submit expense claims, track approval status
- **My Profile** — View personal details, bank info, statutory details
- **Change Password** — Self-service password change with validation

### UI & UX
- **Dark Mode** — Light / Dark / System with persistent toggle
- **Command Palette** — Ctrl+K to search pages, employees, actions
- **Keyboard Navigation** — G+D (Dashboard), G+E (Employees), G+P (Payroll), G+S (Settings)
- **Keyboard Help** — Press ? for categorized shortcut reference
- **Global Search** — Debounced employee search in top bar
- **Notifications** — Bell dropdown with contextual alerts
- **Breadcrumbs** — Auto-generated navigation trail
- **Dashboard Quick Actions** — 6 shortcut buttons (Run Payroll, Add Employee, etc.)
- **Pagination** — Client-side with page numbers on all tables
- **Mobile Responsive** — Hamburger menu, adaptive layouts
- **Error Boundary** — Graceful error handling with recovery
- **Loading Skeletons** — Shimmer states for all pages
- **Lazy Loading** — React.lazy code splitting for all 30+ pages

### Infrastructure
- **Docker Compose** — One-command dev setup (MySQL + Redis + API + Client)
- **Production Docker** — Multi-stage builds, nginx reverse proxy, gzip compression
- **API Rate Limiting** — Auth: 200/15min (dev), 20/15min (prod); API: 100/min
- **Swagger/OpenAPI** — Interactive API docs at /api/v1/docs/openapi.json
- **CI/CD** — GitHub Actions with type-check + tests + build
- **Multi-DB** — MySQL (default), PostgreSQL, or MongoDB via env var
- **Environment Validation** — Server validates required env vars on startup
- **System Health Dashboard** — Real-time uptime, DB status, memory usage, data counts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 6 + TypeScript + Tailwind CSS 4 + React Query |
| Backend | Node.js 20 + Express 5 + TypeScript |
| Database | MySQL 8 (default) / PostgreSQL / MongoDB |
| Cache | Redis 7 |
| Auth | JWT (access + refresh tokens) + bcrypt |
| Validation | Zod (server-side request validation) |
| Charts | Recharts (bar, line, area, pie) |
| Email | Nodemailer (SMTP) |
| Testing | Vitest (67 tests: 40 unit + 27 integration) |
| Monorepo | pnpm workspaces |

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/EmpCloud/emp-payroll.git
cd emp-payroll
docker compose up -d --build
```

Wait ~30 seconds for MySQL to initialize, then seed demo data:

```bash
docker exec emp-payroll-server pnpm --filter @emp-payroll/server exec tsx src/db/seed.ts
```

Access:
- **Frontend**: http://localhost:5175
- **API**: http://localhost:4000
- **API Docs**: http://localhost:4000/api/v1/docs/openapi.json
- **Login**: `ananya@technova.in` / `Welcome@123`

### Option 2: Local Development

**Prerequisites:** Node.js >= 20, pnpm >= 9, MySQL 8+

```bash
git clone https://github.com/EmpCloud/emp-payroll.git
cd emp-payroll
pnpm install

# Configure environment
cp packages/server/.env.example packages/server/.env
# Edit .env with your MySQL credentials

# Run migrations + seed
pnpm --filter @emp-payroll/server exec tsx src/db/migrate.ts
pnpm --filter @emp-payroll/server exec tsx src/db/seed.ts

# Start dev servers (in separate terminals)
pnpm --filter @emp-payroll/server dev    # API on :4000
pnpm --filter @emp-payroll/client dev    # UI on :5173
```

### Option 3: Production Deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Serves on port 80 with nginx reverse proxy, gzip compression, and static asset caching.

---

## Project Structure

```
emp-payroll/
├── packages/
│   ├── shared/                 # Shared types, tax constants (India/US/UK)
│   │   └── src/
│   │       ├── types/          # TypeScript interfaces & enums
│   │       └── constants/      # Tax brackets, PF/ESI rates, state taxes
│   ├── server/                 # Express API (90+ endpoints)
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── routes/     # 13 route modules
│   │   │   │   ├── middleware/ # Auth, rate-limit, error handling
│   │   │   │   ├── validators/ # Zod request schemas
│   │   │   │   └── docs.ts    # OpenAPI specification
│   │   │   ├── services/       # 25 business logic services
│   │   │   │   ├── tax/        # India, US, UK tax engines
│   │   │   │   ├── compliance/ # PF, ESI, PT statutory calculations
│   │   │   │   └── ...        # payroll, employee, salary, etc.
│   │   │   ├── db/
│   │   │   │   ├── adapters/   # Knex (MySQL/PG) + MongoDB adapters
│   │   │   │   ├── migrations/ # 4 schema migrations
│   │   │   │   └── seed.ts    # Demo data seeder
│   │   │   └── config/        # Env validation, app config
│   │   └── tests/
│   │       ├── unit/           # 40 unit tests (tax engines)
│   │       └── integration/    # 27 API integration tests
│   └── client/                 # React SPA (30+ pages)
│       └── src/
│           ├── api/            # Axios client, React Query hooks, auth
│           ├── components/
│           │   ├── layout/     # DashboardLayout, Sidebar, AuthLayout
│           │   └── ui/         # 20+ reusable components
│           ├── pages/          # 30+ lazy-loaded page components
│           ├── lib/            # Utils, theme provider
│           └── styles/         # Tailwind + dark mode CSS
├── docker/                     # Dockerfiles (dev + prod), nginx.conf
├── docker-compose.yml          # Development setup
├── docker-compose.prod.yml     # Production setup
└── .github/workflows/ci.yml   # CI pipeline
```

---

## API Reference

### Authentication (`/api/v1/auth`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/login` | Login with email/password | No |
| POST | `/register` | Register new user | No |
| POST | `/refresh-token` | Refresh access token | No |
| POST | `/change-password` | Change own password | Yes |
| POST | `/reset-employee-password` | Admin reset password | HR Admin |

### Employees (`/api/v1/employees`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List employees (paginated, filterable) | HR Admin/Manager |
| POST | `/` | Create employee | HR Admin/Manager |
| GET | `/export` | Export CSV | HR Admin/Manager |
| GET | `/:id` | Get employee detail | Yes |
| PUT | `/:id` | Update employee | HR Admin/Manager |
| DELETE | `/:id` | Deactivate employee | HR Admin |
| GET | `/:id/bank-details` | Get bank details | Yes |
| PUT | `/:id/bank-details` | Update bank details | HR Admin/Manager |
| GET | `/:id/tax-info` | Get tax info | Yes |
| PUT | `/:id/tax-info` | Update tax info | HR Admin/Manager |
| GET | `/:id/pf-details` | Get PF details | Yes |
| PUT | `/:id/pf-details` | Update PF details | HR Admin/Manager |
| GET | `/:id/notes` | List employee notes | Yes |
| POST | `/:id/notes` | Add note | Yes |
| DELETE | `/:id/notes/:noteId` | Delete note | HR Admin/Manager |

### Payroll (`/api/v1/payroll`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List payroll runs | HR Admin/Manager |
| POST | `/` | Create payroll run | HR Admin/Manager |
| GET | `/:id` | Get run details | HR Admin/Manager |
| POST | `/:id/compute` | Compute payroll | HR Admin/Manager |
| POST | `/:id/approve` | Approve payroll | HR Admin |
| POST | `/:id/pay` | Mark as paid | HR Admin |
| POST | `/:id/cancel` | Cancel run | HR Admin |
| GET | `/:id/payslips` | Get run payslips (with employee names) | HR Admin/Manager |
| POST | `/:id/send-payslips` | Email payslips to all employees | HR Admin/Manager |
| GET | `/:id/reports/pf` | Download PF ECR file | HR Admin/Manager |
| GET | `/:id/reports/esi` | Download ESI return | HR Admin/Manager |
| GET | `/:id/reports/pt` | Download PT return | HR Admin/Manager |
| GET | `/:id/reports/tds` | Get TDS summary | HR Admin/Manager |
| GET | `/:id/reports/bank-file` | Download bank transfer file | HR Admin/Manager |

### Salary Structures (`/api/v1/salary-structures`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List structures | Yes |
| POST | `/` | Create structure | HR Admin |
| GET | `/:id/components` | Get components | Yes |
| POST | `/assign` | Assign to employee | HR Admin/Manager |
| GET | `/employee/:empId` | Get employee salary | Yes |
| GET | `/employee/:empId/history` | Get salary history | Yes |

### Payslips (`/api/v1/payslips`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List payslips | HR Admin/Manager |
| GET | `/export/csv` | Export CSV | HR Admin/Manager |
| GET | `/employee/:empId` | Get employee payslips | Yes |
| GET | `/:id` | Get payslip detail | Yes |
| GET | `/:id/pdf` | Get payslip HTML | Yes |
| POST | `/:id/dispute` | Raise dispute | Yes |
| POST | `/:id/resolve` | Resolve dispute | HR Admin/Manager |

### Self-Service (`/api/v1/self-service`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Employee dashboard data |
| GET | `/payslips` | My payslips |
| GET | `/payslips/:id/pdf` | Download payslip PDF |
| GET | `/salary` | My salary details |
| GET | `/tax/computation` | My tax computation |
| GET | `/tax/declarations` | My declarations |
| POST | `/tax/declarations` | Submit declarations |
| GET | `/tax/form16` | Download Form 16 |
| GET | `/reimbursements` | My reimbursements |
| POST | `/reimbursements` | Submit claim |
| GET | `/profile` | My profile |

### Other Modules
| Module | Base Path | Key Endpoints |
|--------|-----------|---------------|
| Attendance | `/api/v1/attendance` | summary, import, LOP override |
| Leaves | `/api/v1/leaves` | balances, record, adjust |
| Loans | `/api/v1/loans` | CRUD, payments, EMI tracking |
| Reimbursements | `/api/v1/reimbursements` | approve, reject, pay |
| Tax | `/api/v1/tax` | compute, declarations, Form 16 |
| Organizations | `/api/v1/organizations` | settings, activity log |
| Health | `/health` | basic + detailed health checks |
| Docs | `/api/v1/docs/openapi.json` | OpenAPI 3.0.3 spec |

---

## Frontend Pages

### Admin Dashboard (15 pages)
| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats, charts, quick actions, recent activity |
| Employee List | `/employees` | Searchable list with department filters |
| Employee Detail | `/employees/:id` | Full profile, salary, notes, timeline, YTD |
| New Employee | `/employees/new` | Employee creation form |
| Org Chart | `/employees/org-chart` | Organizational hierarchy |
| Payroll Runs | `/payroll/runs` | List runs, create new |
| Run Detail | `/payroll/runs/:id` | Compute/approve/pay, charts, alerts |
| Salary Structures | `/payroll/salary-structures` | Create/view structures with components |
| Analytics | `/payroll/analytics` | Trend charts, MoM comparison |
| Payslips | `/payslips` | Browse all payslips, export CSV |
| Attendance | `/attendance` | Monthly summary, bulk marking |
| Reports | `/reports` | PF ECR, ESI, PT, TDS downloads |
| Settings | `/settings` | Org info, statutory, payment config |
| Audit Log | `/audit-log` | System activity history |
| System Health | `/system/health` | Uptime, DB, memory monitoring |

### Self-Service Portal (7 pages)
| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/my` | Personal stats, quick links |
| Payslips | `/my/payslips` | View/download payslips, dispute |
| Salary | `/my/salary` | CTC breakdown |
| Tax | `/my/tax` | Tax computation, Form 16 |
| Declarations | `/my/declarations` | Submit/track investment proofs |
| Reimbursements | `/my/reimbursements` | Submit/track expense claims |
| Profile | `/my/profile` | Personal details, change password |

### Other Pages
- Login (`/login`) with demo credentials
- Onboarding wizard (`/onboarding`)
- Holidays (`/holidays`)
- Leaves (`/leaves`)
- Loans (`/loans`)
- 404 Not Found

---

## Testing

### Running Tests

```bash
# All tests (unit + integration)
pnpm --filter @emp-payroll/server exec vitest run

# Unit tests only
pnpm --filter @emp-payroll/server exec vitest run tests/unit/

# Integration tests only (requires running server)
pnpm --filter @emp-payroll/server exec vitest run tests/integration/

# Type checking
pnpm --filter @emp-payroll/server exec tsc --noEmit
pnpm --filter @emp-payroll/client exec tsc --noEmit
```

### Test Coverage (67 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `unit/india-tax.test.ts` | 9 | Income tax old/new regime, 80C, HRA, rebate, cess |
| `unit/india-statutory.test.ts` | 9 | PF (ceiling, VPF, DA), ESI, Professional Tax per state |
| `unit/us-tax.test.ts` | 10 | Federal withholding, FICA, Medicare, state tax, FUTA |
| `unit/uk-tax.test.ts` | 12 | PAYE, NIC, student loan, pension, employer cost |
| `integration/api.test.ts` | 27 | Auth, employees, payroll, payslips, salary, notes, attendance, self-service, API docs |

---

## Test Deployment

| Environment | URL |
|-------------|-----|
| Frontend | https://testpayroll.empcloud.com |
| API | https://testpayroll-api.empcloud.com |

SSO integrated with EMP Cloud. HRMS proxy enabled (`USE_CLOUD_HRMS=true`) — attendance and leave data fetched from EMP Cloud.

---

## Deployment

### Docker Compose (Development)

```bash
docker compose up -d --build
# Services: MySQL (3306), Redis (6379), API (4000), Client (5175)
```

### Docker Compose (Production)

```bash
docker compose -f docker-compose.prod.yml up -d --build
# Services: MySQL, Redis, API (internal), Nginx (80)
```

Production config includes:
- Multi-stage Docker builds (smaller images)
- Nginx reverse proxy with gzip compression
- Static asset caching (1 year for hashed files)
- SPA routing (all paths -> index.html)

### Manual Deployment

1. Build the client: `pnpm --filter @emp-payroll/client build`
2. Build the server: `pnpm --filter @emp-payroll/server build`
3. Serve `packages/client/dist/` with nginx
4. Run server: `node packages/server/dist/index.js`

---

## Demo Data

The seed creates a complete demo environment:

| Entity | Details |
|--------|---------|
| Organization | TechNova Solutions Pvt. Ltd. (Bengaluru, Karnataka) |
| Employees | 10 (Ananya Gupta as HR Admin + 9 team members) |
| Departments | Engineering, Design, Product, Finance, HR |
| Salary Structure | Standard CTC (Basic 40%, HRA 50% of Basic, SA) |
| Payroll Run | February 2026 (fully paid with 10 payslips) |
| Login | `ananya@technova.in` / `Welcome@123` |

---

## Environment Variables

See `packages/server/.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PROVIDER` | `mysql` | Database: mysql, postgres, mongodb |
| `DB_HOST` | `localhost` | Database host |
| `DB_PORT` | `3306` | Database port |
| `DB_NAME` | `emp_payroll` | Database name |
| `DB_USER` | `root` | Database user |
| `DB_PASSWORD` | — | Database password |
| `JWT_SECRET` | `change-this` | JWT signing secret (must change in production!) |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `PAYROLL_COUNTRY` | `IN` | Default country for tax rules (IN, US, UK) |
| `SMTP_HOST` | — | Email server host |
| `SMTP_PORT` | `587` | Email server port |
| `SMTP_USER` | — | Email username |
| `SMTP_PASS` | — | Email password |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open command palette |
| `?` | Show keyboard shortcuts |
| `G` then `D` | Go to Dashboard |
| `G` then `E` | Go to Employees |
| `G` then `P` | Go to Payroll |
| `G` then `S` | Go to Settings |
| `G` then `R` | Go to Reports |
| `G` then `A` | Go to Attendance |
| `Esc` | Close modal/palette |

---

## License

[GPL-3.0](./LICENSE) — Free to use, modify, and distribute.

---

**Built with care by the [EmpCloud](https://empcloud.com) team**
