# Backend API

Express 5 API for the car wash admin, customer, and staff applications. It uses PostgreSQL through Prisma, Socket.IO for live updates, Midtrans for online payments, and ImageKit for service images.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL`, `JWT_SECRET`, Midtrans sandbox keys, and `IMAGEKIT_PRIVATE_KEY` in `.env`. Apply the checked-in database migrations and create the sample records:

```powershell
npx prisma migrate deploy
npx prisma db seed
```

Start the API:

```powershell
npm run dev
```

The API listens on `http://localhost:5000` by default. `GET /health` reports whether the HTTP server is running. REST endpoints are under `/api`; Socket.IO uses the same host and port.

## Related applications

- Admin and customer web apps: [`../frontend`](../frontend/README.md)
- Staff mobile app: [carwash-mobile](https://github.com/zachrrd/carwash-mobile)
