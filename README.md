# JDE ERP — AI-Powered Business Operating System (AI-BOS)

> **Enterprise Resource Planning & Predictive Supply Chain Operating System for Heavy-Equipment Spare-Parts Businesses.**
> **Product Owner**: Karan Aggarwal  
> **Business**: Jai Durga Enterprises  

---

## 🌟 Executive Overview

**JDE ERP (AI-BOS)** is a cloud-native ERP platform engineered specifically for spare-parts distribution enterprises. Unlike legacy ERP systems that function merely as passive transaction ledgers, JDE ERP acts as an **autonomous operational co-pilot**—predicting stockouts, automating complex multi-entity transaction flows, generating real-time financial reporting, and assisting business owners in proactive decision-making from any device.

### Key Performance Benchmarks
- **Sub-second Universal Search**: `<500ms` lookup across Part Numbers, OEM Numbers, Invoices, and Customers.
- **Fast Dashboard Load**: `<2s` real-time KPI rendering.
- **Sub-second Page Transitions**: Next.js 16 App Router with Turbopack compilation.

---

## 🚀 Key Features & 14 Core Modules

| Module | Route | Key Capabilities |
|---|---|---|
| **Executive Dashboard** | `/dashboard` | Executive KPIs (Today's Sales, Purchases, Gross Profit, Cash Balance, Inventory Value, Receivables, Payables, Low Stock), weekly trend charts, critical low-stock alert feed, and real-time activity tracking. |
| **Spare Parts Inventory** | `/inventory` | Catalog management with Part Number, OEM Number, Alternate Part #, Brand, Category, Vehicle Compatibility, Warehouse Rack Location, MRP, Cost Price, Sale Price, and Min-Stock thresholds. |
| **Sales & Billing Workflow** | `/sales` | Complete sales lifecycle: Quotations → Sales Orders → Tax Invoices → Payment Collection → Deliveries → Returns & Credit Notes. Includes auto GST calculations (CGST/SGST/IGST). |
| **Purchases & Procurement** | `/purchases` | Supply chain workflow: Purchase Requests → Purchase Orders (PO) → Goods Received Notes (GRN) → Supplier Invoices → Supplier Payments. |
| **Customer Directory** | `/customers` | Customer profiles, GSTIN numbers, credit limit monitors, credit terms (days), and accounts receivable ledgers. |
| **Supplier Directory** | `/suppliers` | Vendor management, GSTIN records, payment terms (30/45/60 days), and accounts payable ledgers. |
| **Expense Logger** | `/expenses` | Operational expenditure logging across Rent, Freight, Salaries, Utilities, Maintenance, and Office supplies with payment mode tracking. |
| **Financial Reports** | `/reports` | Real-time Profit & Loss (P&L) statements, stock valuation summaries, GSTR-1 & GSTR-3B tax summaries, with Excel/CSV export and print triggers. |
| **Analytics & AI Forecasting** | `/analytics` | Predictive stock replenishment recommendations, top 5 best-selling parts ranking, and category revenue distribution mix. |
| **Roles & Permissions** | `/settings` | Fine-grained access control across 5 user roles (*Owner, Manager, Salesman, Accountant, Warehouse Staff*). |
| **Company Settings** | `/settings` | Company profile configuration, tax rates, GSTIN, and document prefix rules (`INV`, `PO`, `QT`). |
| **Notification Center** | Topbar | Real-time alert badges for low-stock warnings, overdue receivables, and pending PO receipts. |
| **Universal Search** | Topbar (`Ctrl+K`) | Instant cross-entity search bar referencing Part #, OEM #, Customer names, and Invoices. |
| **Audit Logging** | `/settings` | Transactional audit trails capturing User ID, action performed, table name, timestamp, and IP address for compliance. |

---

## 🏗️ Tech Stack & Architecture

```
                                  +---------------------------------------+
                                  |         Next.js 16 (App Router)       |
                                  |     React 19 + TypeScript + CSS Tokens|
                                  +-------------------+-------------------+
                                                      |
                                           HTTPS / WebSockets
                                                      |
                                  +-------------------v-------------------+
                                  |        Supabase BaaS / Backend        |
                                  |   Managed PostgreSQL + RLS + Auth    |
                                  +-------------------+-------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |       FastAPI Microservice Layer      |
                                  |     Demand Forecasting & AI Models    |
                                  +---------------------------------------+
```

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript.
- **Design System**: Bespoke dark-mode aesthetic with amber/gold primary accent (`#F59E0B`), glassmorphism cards, CSS variables, and Google Fonts (Inter).
- **Database**: PostgreSQL (managed via Supabase) with 20 relational tables, custom migrations, auto-numbering sequences, performance indexes, and Row-Level Security (RLS).
- **Backend Services**: Supabase SSR + FastAPI microservices for AI analytics.

---

## 🗄️ Database Schema

The system includes **20 core database tables**:

- `erp_profiles` — User accounts & role assignments
- `erp_company_settings` — Organization details & invoice prefixes
- `erp_products` — Spare parts catalog & stock threshold levels
- `erp_stock_ledger` — Immutable stock transaction logs
- `erp_customers` & `erp_suppliers` — Ledger accounts & credit limits
- `erp_quotations`, `erp_sales_orders`, `erp_invoices` — Sales records
- `erp_payments_received`, `erp_deliveries`, `erp_returns` — Sales execution
- `erp_purchase_requests`, `erp_purchase_orders`, `erp_goods_received` — Procurement
- `erp_purchase_invoices`, `erp_payments_made` — Payables
- `erp_expenses` — Operational overhead logs
- `erp_audit_logs` — System compliance logs
- `erp_notifications` — Real-time alerts

---

## ⚡ Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/karanaggarwaljo-hub/jde-erp.git
   cd jde-erp
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env.local` file in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Build for Production**:
   ```bash
   npm run build
   npm run start
   ```

---

## 📄 License & Ownership

Developed for **Jai Durga Enterprises**. All rights reserved.  
Product Owner: **Karan Aggarwal**
