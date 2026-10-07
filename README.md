# 🏠 HostelHub

HostelHub is a web-based hostel and accommodation discovery platform designed primarily for college students.

It provides a centralized platform where students can explore accommodation options, property owners can list and manage properties, and administrators can manage the platform.

The application is built with Flask and PostgreSQL and is deployed using Render.

---

## 🚀 Live Application

**Live Website:**  
https://hostelhub-postgres.onrender.com/

## 📌 Project Overview

Finding suitable student accommodation can be difficult because information about hostels is often scattered across different sources.

HostelHub provides a centralized platform where:

- Students can discover hostels.
- Students can search and filter accommodation options.
- Students can view property details.
- Students can create and manage their accounts.
- Owners can list and manage properties.
- Students can send inquiries to property owners.
- Administrators can manage users and hostel listings.

---

## ✨ Features

### 👨‍🎓 Student Portal

- Student registration and login
- Browse available hostels
- Search and filter hostel listings
- View hostel details
- View rent, location, distance and amenities
- View hostel ratings
- Send inquiries
- Manage personal profile
- Change password
- Logout

### 🏠 Owner Portal

- Owner registration and login
- Add hostel/property listings
- Manage listed properties
- Update property availability
- View property status
- View inquiries from students
- Manage property information

### 🛡️ Admin Portal

- Admin authentication
- View registered users
- Manage hostel listings
- Approve hostel listings
- Reject hostel listings
- Toggle hostel availability
- View platform data
- Manage application-level information

---

## 🗄️ Database

HostelHub uses PostgreSQL as its relational database.

The application stores information related to users, properties, amenities, inquiries, messages, reviews, wishlists and other application data.

### Main database areas

```text
Users
Properties
Amenities
Property-Amenities
Property Images
Wishlists
Inquiries
Messages
Reviews
```

---

## 🛠️ Technology Stack

### Frontend

- HTML5
- CSS3
- JavaScript

### Backend

- Python
- Flask

### Database

- PostgreSQL
- psycopg2

### Environment Configuration

- python-dotenv
- Environment variables

### Deployment

- GitHub
- Render
- Render PostgreSQL
- Gunicorn

---

## 📂 Project Structure

```text
hostelhub-postgres/
│
├── app.py
├── index.html
├── script.js
├── style.css
│
├── schema.sql
├── database.sql
│
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

### File Description

| File | Purpose |
|---|---|
| `app.py` | Flask backend, authentication, APIs and database operations |
| `index.html` | Main frontend page |
| `script.js` | Frontend logic and API interaction |
| `style.css` | Website styling |
| `schema.sql` | PostgreSQL database schema |
| `database.sql` | Database SQL/setup file |
| `requirements.txt` | Python dependencies |
| `.env.example` | Example environment configuration |
| `.gitignore` | Prevents sensitive/unnecessary files from being committed |
| `README.md` | Project documentation |

---

# ⚙️ Local Installation

## 1. Clone the repository

```bash
git clone https://github.com/OjasYadav-shadowmonarch/hostelhub-postgres.git
```

Move into the project:

```bash
cd hostelhub-postgres
```

---

## 2. Create a Python environment

Windows:

```bash
python -m venv .venv
```

Activate it:

```bash
.venv\Scripts\activate
```

---

## 3. Install dependencies

```bash
pip install -r requirements.txt
```

Required packages include:

```text
Flask
psycopg2-binary
python-dotenv
gunicorn
```

---

# 🐘 PostgreSQL Setup

Install PostgreSQL and create a database.

Example:

```sql
CREATE DATABASE roomfinder;
```

Then initialize the database schema using the appropriate SQL file:

```bash
psql -d roomfinder -f schema.sql
```

The production database should be initialized without unnecessary demo data.

---

# 🔐 Environment Variables

Create a `.env` file in the project directory.

Example:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/roomfinder

SECRET_KEY=your-secret-key

FLASK_DEBUG=1

HOST=127.0.0.1
PORT=5000
```

Alternatively, PostgreSQL connection variables can be configured individually:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=roomfinder
PGUSER=postgres
PGPASSWORD=your-postgres-password

SECRET_KEY=your-secret-key
FLASK_DEBUG=1
HOST=127.0.0.1
PORT=5000
```

> Never commit the real `.env` file to GitHub.

Use `.env.example` as a safe configuration template.

---

# ▶️ Running the Application Locally

Run:

```bash
python app.py
```

The application will normally be available at:

```text
http://127.0.0.1:5000
```

---

# 🌐 Production Deployment

HostelHub is deployed using Render.

The production architecture is:

```text
                    GitHub
                       │
                       ▼
              Render Web Service
                       │
                       ▼
                Flask + Gunicorn
                       │
                       ▼
              Render PostgreSQL
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
           Users    Properties  Inquiries
```

### Render Build Command

```bash
pip install -r requirements.txt
```

### Render Start Command

```bash
gunicorn app:app
```

### Production Environment Variables

```text
DATABASE_URL
SECRET_KEY
FLASK_DEBUG=0
```

The production application uses Render's PostgreSQL connection URL.

---

# 🔄 Application Update Workflow

The project uses Git and GitHub for version control.

For normal code changes:

```text
Edit Code
   ↓
Test Locally
   ↓
Git Commit
   ↓
Git Push
   ↓
GitHub
   ↓
Render Automatic Deployment
   ↓
Updated Website
```

Example:

```bash
git add .
git commit -m "Update HostelHub UI"
git push
```

Render can automatically deploy new commits from the configured branch.

---

# 🔀 Recommended Branch Workflow

For larger features, development can be performed on a separate branch.

Example:

```text
main
 │
 └── feature/new-search
          │
          ▼
       Testing
          │
          ▼
    Pull Request
          │
          ▼
         main
          │
          ▼
       Render
```

The `main` branch should represent the stable production version.

---

# 🔒 Security

The project uses environment variables for sensitive configuration.

Sensitive information should NOT be committed to GitHub.

Examples:

```text
.env
DATABASE_URL
PGPASSWORD
SECRET_KEY
```

The `.gitignore` file prevents `.env` from being tracked.

Passwords should be stored using secure password hashing rather than plain-text storage.

---

# 🧪 Demo Data

Production should not depend on automatically generated demo accounts or sample records.

For a clean production database, initialize the required schema without unnecessary demo data.

Demo data can be used separately for development and testing when required.

---

# 📊 Application Data Relationships

The application follows relationships between users, properties and communication data.

```text
Users
  │
  ├───────────────┐
  │               │
  ▼               ▼
Properties      Inquiries
  │               ▲
  │               │
  └───────────────┘
```

Additional application data includes:

```text
Properties
   │
   ├── Amenities
   ├── Images
   ├── Reviews
   └── Wishlists
```

---

# 🧑‍💻 API Overview

Important backend endpoints include authentication, property management, inquiries and application data APIs.

### Authentication

```text
POST /api/auth/login
POST /api/auth/signup
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/profile
PUT  /api/auth/password
```

### Property Management

```text
POST /api/hostels
POST /api/hostels/<id>/toggle-availability
POST /api/hostels/<id>/approve
POST /api/hostels/<id>/reject
POST /api/hostels/<id>/contact
```

### Application Data

```text
GET /api/meta
GET /api/state
GET /api/export
```

> Endpoint names should be kept synchronized with the current Flask implementation as the project evolves.

---

# 🎯 Future Improvements

Possible future enhancements include:

- Advanced hostel search
- Map integration
- Image upload and cloud storage
- Online booking
- Payment integration
- Email notifications
- Real-time messaging
- Advanced admin dashboard
- Hostel verification system
- Student reviews and ratings
- PostgreSQL migrations
- Automated database backups
- Staging environment
- Automated testing
- CI/CD pipeline

---

# 👨‍💻 Developer

**Ojas Yadav**

GitHub:

https://github.com/OjasYadav-shadowmonarch/hostelhub-postgres

---

# 📄 License

This project is currently developed as an academic/educational project.

A specific open-source license can be added if the project is later released under one.

---

## 📊 Project Status

**Status:** Active Development

Current deployment stack:

```text
GitHub
   +
Render
   +
PostgreSQL
   +
Flask
   +
Gunicorn
```
