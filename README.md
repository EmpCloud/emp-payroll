# 💰 EMP Payroll

**Open-source payroll management system — part of the [EmpCloud](https://empcloud.com) HRMS ecosystem.**

India-first payroll engine with PF, ESI, TDS, and Professional Tax built in. Designed to be the open-source alternative to Zoho Payroll, Keka, and Razorpay Payroll.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

## Features

- **Salary Structure Builder** — CTC breakdown with configurable components (Basic, HRA, Special Allowance, etc.)
- **India Tax Engine** — Old & New regime TDS computation with Sec 80C/80D deductions, HRA exemption, surcharge, cess
- **Statutory Compliance** — PF (EPF/EPS), ESI, Professional Tax for all major Indian states
- **Payroll Processing** — Monthly payroll runs with draft → compute → approve → pay workflow
- **Payslip Generation** — PDF payslips with YTD tracking, emailed to employees
- **Employee Self-Service** — Employees view payslips, submit tax declarations, switch regime, download Form 16
- **Attendance Integration** — Sync with EmpMonitor or import CSV for LOP/overtime calculation
- **Multi-DB Support** — Switch between MySQL, PostgreSQL, or MongoDB without code changes
- **Audit Trail** — Every payroll action is logged for compliance

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | MySQL (default) / PostgreSQL / MongoDB |
| Queue | BullMQ + Redis |
| PDF | Puppeteer + Handlebars templates |
| Auth | JWT (access + refresh tokens) |
| Validation | Zod (shared between client & server) |

---

## Project Structure

```
emp-payroll/
├── packages/
│   ├── shared/              # Shared types, constants, validators
│   │   └── src/
│   │       ├── types/       # TypeScript interfaces (Employee, Payslip, etc.)
│   │       └── constants/   # India tax slabs, PF rates, PT slabs
│   │
│   ├── server/              # Express API
│   │   └── src/
│   │       ├── api/
│   │       │   ├── routes/          # 9 route modules
│   │       │   ├── controllers/     # Request handlers
│   │       │   ├── middleware/      # Auth, error, validation
│   │       │   └── validators/      # Zod schemas
│   │       ├── services/
│   │       │   ├── payroll/         # Payroll computation engine
│   │       │   ├── tax/             # India TDS calculator
│   │       │   ├── compliance/      # PF, ESI, PT calculators
│   │       │   ├── attendance/      # Attendance sync
│   │       │   └── employee/        # Employee CRUD
│   │       ├── db/
│   │       │   ├── adapters/        # DB abstraction (MySQL/PG/Mongo)
│   │       │   ├── migrations/      # SQL migrations
│   │       │   └── seeds/           # Sample data
│   │       ├── config/
│   │       ├── utils/
│   │       └── jobs/                # Background jobs (payslip PDF, email)
│   │
│   └── client/              # React SPA
│       └── src/
│           ├── api/                 # Axios client + typed helpers
│           ├── components/          # Reusable UI components
│           ├── pages/
│           │   ├── auth/            # Login
│           │   ├── dashboard/       # Admin dashboard
│           │   ├── employees/       # Employee CRUD
│           │   ├── payroll/         # Salary structures, payroll runs
│           │   ├── payslips/        # Payslip list + PDF download
│           │   ├── tax/             # Tax overview + declarations
│           │   ├── attendance/      # Attendance sync
│           │   ├── settings/        # Org settings
│           │   └── self-service/    # Employee portal (6 pages)
│           ├── store/               # Zustand stores
│           └── styles/
│
├── docs/                    # Architecture docs, API reference
├── docker/                  # Dockerfiles
├── docker-compose.yml       # MySQL + Redis + Mongo + PG
└── .env.example
```

---

## Quick Start

### Prerequisites
- Node.js >= 20
- MySQL 8+ (or PostgreSQL 16+ or MongoDB 7+)
- Redis 7+

### 1. Clone & Install

```bash
git clone https://github.com/EmpCloud/emp-payroll.git
cd emp-payroll
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 3. Start Infrastructure (Docker)

```bash
# Default: MySQL + Redis
docker compose up -d

# With PostgreSQL instead:
docker compose --profile postgres up -d

# With MongoDB instead:
docker compose --profile mongodb up -d
```

### 4. Run Migrations & Seed

```bash
npm run db:migrate
npm run db:seed
```

### 5. Start Development

```bash
npm run dev
# Server: http://localhost:4000
# Client: http://localhost:5173
```

---

## Database Switching

Change `DB_PROVIDER` in `.env` — zero code changes needed:

```bash
# MySQL (default)
DB_PROVIDER=mysql
DB_HOST=localhost
DB_PORT=3306

# PostgreSQL
DB_PROVIDER=postgres
DB_HOST=localhost
DB_PORT=5432

# MongoDB
DB_PROVIDER=mongodb
MONGO_URI=mongodb://localhost:27017/emp_payroll
```

---

## API Routes

| Module | Base Path | Endpoints |
|--------|-----------|-----------|
| Auth | `/api/v1/auth` | login, register, refresh, logout |
| Organizations | `/api/v1/organizations` | CRUD + settings |
| Employees | `/api/v1/employees` | CRUD + bank/tax/PF details, import/export |
| Salary Structures | `/api/v1/salary-structures` | CRUD + components, assign to employee |
| Payroll | `/api/v1/payroll` | runs, compute, approve, pay, statutory reports |
| Payslips | `/api/v1/payslips` | list, PDF download, dispute |
| Tax | `/api/v1/tax` | computation, declarations, regime, Form 16 |
| Attendance | `/api/v1/attendance` | summary, import, sync, LOP override |
| Self-Service | `/api/v1/self-service` | dashboard, my payslips/salary/tax/profile |

---

## India Compliance (FY 2025-26)

- **Income Tax**: Old & New regime slabs, Sec 87A rebate, marginal relief, surcharge, 4% cess
- **PF**: 12% employee, 3.67% employer EPF + 8.33% EPS, admin/EDLI charges
- **ESI**: 0.75% employee + 3.25% employer (gross ≤ ₹21,000)
- **Professional Tax**: Karnataka, Maharashtra, Tamil Nadu, Telangana, West Bengal, Gujarat, Delhi
- **Section 80C/80D/80CCD**: Declaration workflow with proof upload and approval

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Priority areas for v1:
1. Employee self-service portal UI
2. Payslip PDF template
3. More state PT slabs
4. Unit tests for tax engine
5. Swagger/OpenAPI docs

---

## License

[GPL-3.0](./LICENSE) — Free to use, modify, and distribute. Modified versions must also be open source.

---

## Part of the EmpCloud Ecosystem

| Module | Status |
|--------|--------|
| [EmpMonitor](https://github.com/EmpCloud/EmpMonitor) | ✅ Live |
| **EMP Payroll** | 🚧 Building |
| EMP HRMS | 📋 Planned |
| EMP Recruit | 📋 Planned |
| EMP Field Force | 📋 Planned |

---

**Built with ❤️ by the [EmpCloud](https://empcloud.com) team**
