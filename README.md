# TrueHive ERP & CRM - Enterprise Backend Engine (NestJS)

Enterprise-grade, modular, and domain-driven backend engine built with **NestJS**, **TypeScript**, **Prisma ORM**, **Supabase PostgreSQL**, **Upstash Redis**, **Google Gemini AI**, and **Meta WhatsApp Cloud API**.

---

## 🏛️ Domain-Driven Architecture

The backend is organized into 6 core business domains under `src/domains/`:

1. **`iam/`** - Identity & Access Management (JWT, Cookies, Roles/RBAC).
2. **`communication-ai/`** - WhatsApp Meta Cloud API Webhook, Blue Ticks, Gemini 2.5 Flash Agentic Loop, Zoho Campaigns.
3. **`crm/`** - Customer directory, Leads pipeline, WhatsApp live chat rooms, and agent handover.
4. **`commerce/`** - POS counter checkout (atomic stock deduction), Products, Categories, Barcodes, and Orders.
5. **`finance/`** - Cashflow ledger, Transactions, Invoices, and Google Docs executive sync.
6. **`hrm/`** - Human Resource Management foundation:
   - Biometric & Geolocation Attendance Clock-in
   - Sri Lankan Legal EPF (8% employee + 12% employer), ETF (3%), OT, and Net Salary Calculation.

---

## 🚀 Quick Start

### 1. Development Mode
```bash
cd E:\truehive-erp\backend
npm install
npm run start:dev
```
- API Base: `http://localhost:4000/api/v1`
- Swagger OpenAPI Docs: `http://localhost:4000/api/docs`
- Health Probe: `http://localhost:4000/api/v1/health`

### 2. Production Docker Deployment
```bash
docker compose up -d --build
```

---

## 🌐 AWS Production Hosting
- Deploy this container to **AWS Lightsail** ($5 - $10/mo) or **AWS ECS/App Runner**.
- Connect AWS Application Load Balancer to the health check endpoint: `/api/v1/health`.
