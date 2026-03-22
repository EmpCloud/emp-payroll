-- =============================================================================
-- EmpCloud: Initialize all databases in shared MySQL instance
-- This runs automatically on first MySQL startup
-- =============================================================================

-- App 1: EMP Payroll
CREATE DATABASE IF NOT EXISTS emp_payroll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS empcloud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- App 2: EMP Billing
CREATE DATABASE IF NOT EXISTS emp_billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- App 3: EMP LMS
CREATE DATABASE IF NOT EXISTS emp_lms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- For production, create separate DB users per app with limited privileges.
-- See deployment docs for recommended setup.
