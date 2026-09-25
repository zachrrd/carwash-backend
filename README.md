# ⚙️ Car Wash Management REST & Real-Time API Engine

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma_7-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Midtrans](https://img.shields.io/badge/Midtrans-Snap_&_Webhooks-002B49?style=for-the-badge)](https://midtrans.com/)

> **High-performance REST & WebSocket API backend** powering the entire Car Wash Management ecosystem (Admin Dashboard, Customer Web Portal, and Staff Mobile App). Built with layered architecture, strong typing, atomic SQL transactions, and real-time event broadcasting.

---

## 🏗️ Architecture & Core Modules

Backend ini dibangun menggunakan pola **Layered Architectural Pattern** untuk memastikan pemisahan tanggung jawab (*separation of concerns*), skalabilitas, dan kemudahan pengujian:

- **Routes (`src/routes/`)**: Mendefinisikan endpoint API, mengikat middleware autentikasi dan validasi.
- **Controllers (`src/controllers/`)**: Menangani validasi payload HTTP, memanggil database melalui Prisma Client, dan mengembalikan respons terstandarisasi.
- **Middlewares (`src/middlewares/`)**:
  - `auth.middleware.ts`: Verifikasi JSON Web Token (JWT).
  - `role.middleware.ts`: Pembatasan akses berbasis peran (`ADMIN`, `CASHIER`, `CUSTOMER`).
  - `socket.middleware.ts`: Autentikasi koneksi WebSocket saat handshake awal.
  - `upload.middleware.ts`: Pemrosesan upload file menggunakan Multer sebelum diteruskan ke cloud media storage (ImageKit).
  - `error.middleware.ts`: Global error handler terpusat.
- **Services & Config (`src/services/` & `src/config/`)**: Konfigurasi koneksi database PostgreSQL via Prisma Adapter, inisialisasi Midtrans Snap API, integrasi ImageKit SDK, dan instance Socket.IO.
- **Utils (`src/utils/`)**: Helper response wrapper konsisten (`successResponse`, `errorResponse`), generator invoice PDF (`pdfkit`), serta integrasi ImageKit.

---

## 📊 Database Schema & ERD Overview

Database dirancang secara relasional menggunakan **PostgreSQL** dan dikelola oleh **Prisma ORM**:

```mermaid
erDiagram
    USERS ||--o| CUSTOMERS : "has profile"
    CUSTOMERS ||--o{ VEHICLES : owns
    CUSTOMERS ||--o{ ORDERS : places
    VEHICLES ||--o{ ORDERS : assigned_to
    ORDERS ||--o{ ORDER_ITEMS : contains
    SERVICES ||--o{ ORDER_ITEMS : referenced_in
    ORDERS ||--o{ ORDER_STAFF : assigned_staff
    STAFFS ||--o{ ORDER_STAFF : works_on
    ORDERS ||--o{ PAYMENTS : settles
    ORDERS ||--o{ INVOICES : generates

    USERS {
        int id PK
        string name
        string email UK
        string password
        enum role "ADMIN | CASHIER | CUSTOMER"
        datetime created_at
    }

    CUSTOMERS {
        int id PK
        int user_id FK
        string name
        string phone
        datetime deleted_at "Soft Delete"
    }

    STAFFS {
        int id PK
        string name
        string phone
        enum status "ACTIVE | INACTIVE"
        datetime deleted_at "Soft Delete"
    }

    VEHICLES {
        int id PK
        string plate_number UK
        string brand
        string model
        int customer_id FK
        datetime deleted_at "Soft Delete"
    }

    SERVICES {
        int id PK
        string name
        int duration
        decimal price
        string image_url
        enum status "ACTIVE | INACTIVE"
        datetime deleted_at "Soft Delete"
    }

    ORDERS {
        int id PK
        int customer_id FK
        int vehicle_id FK
        enum service_status "WAITING | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED"
        enum payment_status "UNPAID | PAID | REFUNDED | FAILED"
        string check_in_time
        datetime order_date
    }

    ORDER_STAFF {
        int id PK
        int order_id FK
        int staff_id FK
        datetime assigned_at
    }

    ORDER_ITEMS {
        int id PK
        int order_id FK
        int service_id FK
        int qty
        decimal subtotal
    }

    PAYMENTS {
        int id PK
        int order_id FK
        decimal amount_received
        decimal change_amount
        enum payment_method "CASH | TRANSFER | QRIS"
        datetime payment_date
    }

    INVOICES {
        int id PK
        string invoice_no UK
        int order_id FK
        decimal total_amount
        datetime issued_at
    }
```

---

## ⚡ Real-Time Socket.IO Architecture

Socket.IO berjalan berdampingan pada HTTP Server yang sama (`src/index.ts`) dan mengamankan koneksi melalui JWT handshake:

### 1. Rooms
- **`orders`**: Dihuni otomatis oleh user berhak akses operasional (`ADMIN` dan `CASHIER`). Menerima notifikasi global terkait antrean masuk dan pembaruan transaksi.
- **`order:{id}`**: Room terisolasi untuk transaksi tertentu. Hanya dapat dimasuki oleh Admin, Kasir, atau Customer pemilik pesanan tersebut.

### 2. Events Matrix

| Event Name | Direction | Payload | Deskripsi |
|---|---|---|---|
| `join-order` | Client ➔ Server | `orderId: number` | Klien bergabung ke room pesanan untuk tracking live. |
| `leave-order` | Client ➔ Server | `orderId: number` | Klien meninggalkan room pesanan. |
| `order-status-updated` | Server ➔ Room | `{ orderId, service_status, payment_status, updated_at }` | Disiarkan saat status pengerjaan atau pembayaran berubah. |
| `new-order` | Server ➔ `orders` | `{ order: OrderData }` | Notifikasi pesanan baru masuk ke Admin & Mobile Staff. |
| `order-paid` | Server ➔ Room | `{ orderId, payment, invoice }` | Notifikasi bahwa pembayaran (Cash / Midtrans) telah terverifikasi. |

---

## 💳 Midtrans Payment Lifecycle

1. **Token Generation**: Saat Customer melakukan checkout, backend memanggil Midtrans Snap API (`snap.createTransactionToken`) menggunakan Server Key.
2. **Transaction Token**: Token dikembalikan ke frontend untuk merender modal pembayaran Midtrans Snap.
3. **Webhook Notification**: Setelah customer menyelesaikan pembayaran, Midtrans mengirimkan HTTP POST ke `/api/payments/notification` atau `/payments/notification`.
4. **Signature Verification**:
   ```typescript
   const hash = crypto.createHash("sha512")
     .update(`${order_id}${status_code}${gross_amount}${MIDTRANS_SERVER_KEY}`)
     .digest("hex");
   ```
5. **Atomic Execution**: Jika hash valid dan status `settlement` / `capture`, backend mengeksekusi `prisma.$transaction`:
   - Mengubah `orders.payment_status` menjadi `PAID`.
   - Mengubah `orders.service_status` menjadi `CONFIRMED`.
   - Membuat rekaman di `payments` (metode `QRIS` atau `TRANSFER`).
   - Menerbitkan `invoices` otomatis.
   - Mengirim event real-time `order-paid` via Socket.IO.

---

## 📡 REST API Endpoints Specification

### 1. Autentikasi (`/api/auth`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Pendaftaran akun baru customer. |
| `POST` | `/api/auth/login` | Public | Login akun (Admin, Cashier, Customer) menghasilkan JWT token. |
| `GET` | `/api/auth/profile` | Authenticated | Mendapatkan data profil dan role pengguna aktif saat ini. |

### 2. Services (`/api/services`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `GET` | `/api/services` | Public / Auth | Mendapatkan daftar layanan cuci mobil aktif. |
| `POST` | `/api/services` | Admin | Menambah paket layanan baru (mendukung upload gambar via ImageKit). |
| `GET` | `/api/services/:id` | Public / Auth | Detail paket layanan tertentu. |
| `PUT` | `/api/services/:id` | Admin | Memperbarui nama, harga, durasi, atau status layanan. |
| `DELETE` | `/api/services/:id` | Admin | Soft-delete paket layanan cuci. |

### 3. Kendaraan (`/api/vehicles`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `GET` | `/api/vehicles` | Authenticated | Menampilkan daftar kendaraan (Admin melihat semua, Customer melihat miliknya). |
| `POST` | `/api/vehicles` | Authenticated | Mendaftarkan plat nomor kendaraan baru. |
| `GET` | `/api/vehicles/:id` | Authenticated | Detail spesifikasi kendaraan. |
| `PUT` | `/api/vehicles/:id` | Authenticated | Memperbarui data kendaraan. |
| `DELETE` | `/api/vehicles/:id` | Admin | Soft-delete kendaraan dari sistem. |

### 4. Pelanggan (`/api/customers`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `GET` | `/api/customers` | Admin, Cashier | Menampilkan seluruh data customer terdaftar. |
| `GET` | `/api/customers/trash` | Admin | Menampilkan data customer yang berada di tempat sampah (soft-deleted). |
| `POST` | `/api/customers/:id/restore`| Admin | Memulihkan data customer yang terhapus. |
| `DELETE` | `/api/customers/:id` | Admin | Melakukan soft-delete terhadap pelanggan. |

### 5. Staf Lapangan (`/api/staffs`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `GET` | `/api/staffs` | Admin, Cashier | Menampilkan daftar staf operasional pencuci mobil. |
| `POST` | `/api/staffs` | Admin | Menambahkan staf operasional baru. |
| `PUT` | `/api/staffs/:id` | Admin | Mengubah status aktif / nomor telepon staf. |
| `DELETE` | `/api/staffs/:id` | Admin | Soft-delete staf. |

### 6. Pesanan & Antrean (`/api/orders`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `GET` | `/api/orders` | Authenticated | Menampilkan daftar order aktif atau riwayat filter. |
| `POST` | `/api/orders` | Authenticated | Membuat transaksi order baru (layanan, mobil, jadwal). |
| `GET` | `/api/orders/:id` | Authenticated | Detail transaksi order, daftar layanan, dan staf penanggung jawab. |
| `PATCH`| `/api/orders/:id/status`| Admin, Cashier | Memperbarui status cuci (`CONFIRMED`, `IN_PROGRESS`, `COMPLETED`). |
| `POST` | `/api/orders/:id/assign`| Admin, Cashier | Menugaskan teknisi pencuci mobil (*multi-staff assignment*). |

### 7. Pembayaran & Invoice (`/api/payments` & `/api/invoices`)
| Method | Endpoint | Access | Deskripsi |
|---|---|---|---|
| `POST` | `/api/payments/snap-token` | Authenticated | Menghasilkan Midtrans Snap Token untuk transaksi digital. |
| `POST` | `/api/payments/notification`| Public (Midtrans)| Webhook resmi penerima notifikasi pembayaran sukses dari Midtrans. |
| `POST` | `/api/payments/cash` | Admin, Cashier | Pelunasan transaksi secara tunai di kasir loket. |
| `GET` | `/api/invoices/:orderId` | Authenticated | Mengambil faktur rincian transaksi dalam format JSON. |
| `GET` | `/api/invoices/:orderId/pdf`| Authenticated | Mengunduh berkas invoice PDF resmi beresolusi tinggi (`PDFKit`). |

---

## 🛠️ Panduan Instalasi & Menjalankan API

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables Configuration
Buat berkas `.env` dari template `.env.example`:
```bash
cp .env.example .env
```

Isi variabel konfigurasi:
```env
PORT=5000
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/carwash_db?schema=public"
JWT_SECRET="your_very_secure_jwt_secret"
CUSTOMER_FE_URL="http://localhost:5173"

# Midtrans Integration
MIDTRANS_SERVER_KEY="SB-Mid-server-xxxx"
MIDTRANS_CLIENT_KEY="SB-Mid-client-xxxx"
MIDTRANS_IS_PRODUCTION=false

# ImageKit Storage
IMAGEKIT_PUBLIC_KEY="your_imagekit_public_key"
IMAGEKIT_PRIVATE_KEY="your_imagekit_private_key"
IMAGEKIT_URL_ENDPOINT="https://ik.imagekit.io/your_id"
```

### 3. Migrasi Database & Seeding
Pastikan instance PostgreSQL Anda sudah berjalan:
```bash
# Sinkronkan schema Prisma dengan database
npx prisma generate
npx prisma migrate dev --name init

# Jalankan seeder akun default dan layanan cuci mobil
npm run prisma:seed
```

### 4. Menjalankan Server
```bash
# Mode Development (Live reload dengan tsx watch)
npm run dev

# Mode Production Build
npm run build
npm run start
```
Server akan aktif di `http://localhost:5000`. Lakukan uji konektivitas via `GET /health` atau `GET /api/health`.

---

## 📁 Direktori Source Code

```text
src/
├── config/             # Konfigurasi Prisma, Midtrans, ImageKit, Socket
├── controllers/        # Request handling logic
├── middlewares/        # Auth JWT, Role Guard, Socket handshake, Error handler
├── routes/             # REST route mapping
├── services/           # Payment & business logic services
├── types/              # TypeScript interface & type definitions
├── utils/              # PDF generator, ImageKit client, Response formatters
├── validations/        # Request schema validation
└── index.ts            # Main application bootstrap & HTTP/WebSocket runner
```

---

## 👨‍💻 Maintainer
**Zacharia** - [@zachrrd](https://github.com/zachrrd)
Repository: [carwash-backend](https://github.com/zachrrd/carwash-backend)
