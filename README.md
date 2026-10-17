# 🏠 HostelHub — Student Accommodation Platform

**Find your space. Feel at home.**

HostelHub is a web-based student accommodation discovery and management platform. It connects students looking for hostels, PGs and rooms with property owners who want to list and manage their properties.

Administrators can moderate listings and manage users through a dedicated admin portal.

**Live Website:** https://hostelhub-postgres.onrender.com/  
**Repository:** https://github.com/OjasYadav-shadowmonarch/hostelhub-postgres

---

## 📌 Table of Contents

- [Project Overview](#-project-overview)
- [Features](#-features)
- [Technology Stack](#️-technology-stack)
- [Project Structure](#-project-structure)
- [Version History](#-version-history)
- [Application Architecture](#️-application-architecture)
- [Installation and Setup](#-installation-and-setup)
- [Database Configuration](#-database-configuration)
- [Deployment](#-deployment)
- [Development Workflow](#-development-workflow)
- [Security](#-security)
- [Future Scope](#-future-scope)
- [Contributing](#-contributing)

---

## 🎯 Project Overview

Finding suitable student accommodation can be challenging because information about hostels and PGs is often scattered across different sources.

HostelHub aims to simplify this process by providing a centralized platform where:

- Students can discover and compare accommodation options.
- Property owners can publish and manage listings.
- Students can contact owners through inquiries.
- Administrators can review listings and manage platform users.
- Users can manage their profiles and account settings.

The application uses a Flask backend, a PostgreSQL database and a responsive HTML, CSS and JavaScript frontend.

## ✨ Features

### 🎓 Student Portal

- Student registration and login.
- Browse available hostels, PGs and rooms.
- Search listings and filter by accommodation type.
- View property details, rent, location, distance, amenities and ratings.
- View property locations on an interactive map.
- Save favourite properties.
- Compare selected accommodation options.
- Send inquiries to property owners.
- Manage account details and change passwords.
- Responsive layout for mobile, tablet and desktop screens.

### 🏠 Owner Portal

- Owner registration and login.
- Add new property listings.
- Edit existing property details.
- Upload or provide property images.
- Select property locations using the map interface.
- Manage property availability.
- View listing approval and publication status.
- Review student inquiries and mark them as responded.
- View listing statistics and analytics.
- Access listing actions on smaller screens.

### 🛡️ Admin Portal

- Dedicated administrator access.
- View and manage registered users.
- Activate or deactivate user accounts.
- Review, approve and reject property listings.
- Manage property availability.
- Delete listings when appropriate.
- View platform information.
- Use responsive tables with accessible action controls on smaller screens.

### 🎨 UI/UX and Responsiveness

- Responsive landing page.
- Dark and light theme support.
- Animated landing-page background effects.
- Map-inspired visual effects with glowing elements and moving particles.
- Role-specific animated backgrounds for supported portal screens.
- Responsive mobile navigation with an expandable menu.
- Mobile-friendly layouts for cards, forms, listing actions and tables.
- Touch-friendly navigation and action controls.
- Improved overflow handling for narrow screens.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Python, Flask |
| Database | PostgreSQL |
| Database driver | psycopg2 |
| Authentication | Flask sessions and password hashing |
| Environment configuration | python-dotenv |
| Maps | MapLibre GL JS and OpenFreeMap map styles |
| Web server | Gunicorn |
| Version control | Git and GitHub |
| Deployment | Render |

---

## 📂 Project Structure

```text
hostelhub-postgres/
│
├── app.py
├── index.html
├── style.css
├── script.js
│
├── schema.sql
├── database.sql
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
│
└── static/
    ├── favicon.ico
    ├── favicon-16x16.png
    ├── favicon-32x32.png
    ├── apple-touch-icon.png
    └── effects/
        └── role-backgrounds.css
```

*Note: The structure above highlights the main project files. Other files and assets may exist in the repository.*

| File | Purpose |
|---|---|
| `app.py` | Flask application, API endpoints, authentication and database operations |
| `index.html` | Main application interface and page structure |
| `style.css` | Layout, styling, themes, animations and responsive design |
| `script.js` | Frontend functionality, navigation, rendering and API communication |
| `schema.sql` | PostgreSQL schema and table definitions |
| `database.sql` | SQL setup and database initialization resources |
| `requirements.txt` | Python package dependencies |
| `.env.example` | Template for local environment configuration |
| `.gitignore` | Excludes sensitive and unnecessary files from version control |
| `README.md` | Project documentation |
| `static/` | Static resources such as icons and visual-effect styles |

---

## 📜 Version History

The following milestones document the project's development in chronological order. The version numbers are proposed project versions for documentation; they do not imply that matching Git tags have already been published.

### Version 1.0.0 — Core Platform

**Focus:** Initial HostelHub application.

- Established the student, owner and administrator portal structure.
- Implemented the core accommodation discovery workflow.
- Added property listing and management functionality.
- Introduced authentication and user account management.
- Established the main frontend and backend architecture.

### Version 1.1.0 — PostgreSQL Migration and Deployment

**Focus:** Database-backed application and online availability.

- Integrated PostgreSQL for persistent application data.
- Connected the Flask backend to the database using `psycopg2`.
- Added environment-based database configuration.
- Organized SQL schema and database setup resources.
- Prepared the application for deployment through GitHub and Render.

### Version 1.2.0 — Interactive Map Integration

**Focus:** Location-aware accommodation discovery.

- Integrated a map interface using MapLibre GL JS.
- Added map-based property location selection to the listing workflow.
- Added support for property latitude and longitude.
- Improved the ability to represent accommodation locations visually.

### Version 1.3.0 — Visual Effects and Landing-Page Enhancement

**Focus:** A richer and more distinctive user interface.

- Enhanced the landing page with map-inspired visual effects.
- Added glow, pin, particle and cursor-interaction effects.
- Introduced role-specific animated background styling for supported portal screens.
- Improved visual presentation across dark and light themes.
- Included responsive considerations for smaller screens and reduced-motion preferences.

### Version 1.4.0 — Responsive Navigation

**Focus:** Improved navigation on mobile devices.

- Added a collapsible mobile navigation menu to the application header.
- Added menu open/close behaviour.
- Updated navigation accessibility attributes.
- Improved header spacing and layout on smaller screens.
- Preserved the desktop navigation layout.

### Version 1.4.1 — Mobile Tables and Action Accessibility

**Focus:** Making important controls accessible on narrow screens.

- Added horizontal overflow handling for wide data tables.
- Added a sticky rightmost table column on smaller screens to keep action controls accessible while scrolling.
- Improved mobile spacing for table cells and action buttons.
- Improved owner listing action wrapping.
- Improved student search and filter layouts.
- Added responsive adjustments for inquiry tables and form controls.

**Current documented milestone:** `1.4.1 — Mobile Tables and Action Accessibility`

The version history describes development milestones rather than verified release tags. Update this section whenever a new feature or significant fix is merged into the stable branch.

---

## 🏗️ Application Architecture

```text
               Student / Owner / Admin
                         |
                         v
              HTML + CSS + JavaScript
                         |
                         v
                  Flask REST API
                         |
                         v
                    PostgreSQL
```

### Architecture Components

1. **Frontend:** Displays the landing page, dashboards, forms, listings and responsive navigation.
2. **Backend:** Processes requests, authenticates users and performs application operations.
3. **Database:** Stores user accounts, properties, inquiries and other application records.
4. **Map integration:** Displays geographic information and supports property location selection.
5. **Deployment:** Hosts the web application and database using the configured Render services.

---

## 💻 Installation and Setup

### Prerequisites

Install the following before running the project locally:

- Python 3.
- PostgreSQL.
- Git.
- A code editor such as Visual Studio Code.

### 1. Clone the repository

```bash
git clone https://github.com/OjasYadav-shadowmonarch/hostelhub-postgres.git
cd hostelhub-postgres
```

### 2. Create a virtual environment

**Windows PowerShell:**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell activation is unavailable, use Command Prompt:

```bat
.venv\Scripts\activate.bat
```

### 3. Install dependencies

```bash
python -m pip install -r requirements.txt
```

### 4. Configure environment variables

Create a local `.env` file using `.env.example` as the reference.

Configure the database connection and a secure application secret before starting the backend.

### 5. Initialize PostgreSQL

Create a database and execute the appropriate schema file.

```sql
CREATE DATABASE roomfinder;
```

Then, from the project directory:

```bash
psql -U postgres -d roomfinder -f schema.sql
```

Use the actual database name and PostgreSQL username configured on your machine.

**Important:** Inspect the SQL files before executing them against an existing database. Do not run destructive SQL operations on production data.

### 6. Start the application

```bash
python app.py
```

Open the local application at:

http://127.0.0.1:5000

The actual port depends on your local configuration.

---

## 🗄️ Database Configuration

HostelHub uses PostgreSQL as its relational database.

The application supports a connection URL through `DATABASE_URL` or individual PostgreSQL connection variables.

Example local `.env` configuration:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/roomfinder
SECRET_KEY=replace-with-a-long-random-secret
FLASK_DEBUG=1
HOST=127.0.0.1
PORT=5000
```

Alternatively, configure the connection using individual variables:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=roomfinder
PGUSER=postgres
PGPASSWORD=your-local-password

SECRET_KEY=replace-with-a-long-random-secret
FLASK_DEBUG=1
HOST=127.0.0.1
PORT=5000
```

Do not configure both connection methods unnecessarily. `DATABASE_URL` takes precedence when present.

### Main Data Areas

The database includes core entities such as:

- Users
- Hostels and property listings
- Student inquiries
- Reviews
- Wishlists

The exact schema and relationships are defined in the SQL files and backend implementation.

---

## 🌐 Deployment

HostelHub's public deployment is available at:

https://hostelhub-postgres.onrender.com/

### Render configuration

**Build command**

```bash
pip install -r requirements.txt
```

**Start command**

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

Configure the required production environment variables in the Render dashboard.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL |
| `SECRET_KEY` | Secret used to sign Flask sessions |
| `FLASK_DEBUG` | Keep disabled in production |
| `ADMIN_USERNAME` | Optional configured administrator username |
| `ADMIN_PASSWORD` | Optional configured administrator password |

The actual variables required depend on the backend configuration and deployment settings.

Never publish real credentials in this README or commit them to GitHub.

---

## 🔄 Development Workflow

The project uses GitHub for version control and supports branch-based development.

Recommended workflow:

```text
Create Feature Branch
         |
         v
   Make Changes
         |
         v
  Review and Test
         |
         v
  Commit Changes
         |
         v
   Open Pull Request
         |
         v
 Merge into main
         |
         v
  Render Deployment
```

Example Git commands:

```bash
git checkout -b feature/mobile-improvements
git add .
git commit -m "Improve mobile responsiveness"
git push -u origin feature/mobile-improvements
```

Use a pull request to review changes before merging them into `main`.

If Render is configured for automatic deployment from `main`, merging a commit may trigger a new deployment.

---

## 🔐 Security

- Keep `.env` out of version control.
- Use strong, unique secrets for production.
- Store passwords using secure password hashing.
- Configure administrator credentials through the deployment environment.
- Never commit database passwords, API secrets or private credentials.
- Use HTTPS for the deployed application.
- Back up production data before performing database changes.
- Test authentication and role-based permissions after backend updates.

---

## 🚀 Future Scope

Potential future improvements include:

- Google sign-in and email verification.
- Improved property discovery and location-based search.
- Advanced filtering and accommodation comparison.
- More detailed owner analytics.
- Email notifications for student inquiries.
- Improved admin moderation tools.
- Additional accessibility and mobile usability improvements.
- Automated tests and application monitoring.
- Performance improvements and database optimization.

These items are possible future enhancements and should not be interpreted as already implemented.

---

## 🤝 Contributing

Contributions and suggestions are welcome.

1. Fork the repository or create an authorized feature branch.
2. Make a focused change.
3. Test the affected functionality.
4. Commit your changes with a descriptive message.
5. Submit a pull request for review.

Please avoid unrelated changes in feature-specific pull requests.

---

## 👨‍💻 Project Information

**Project:** HostelHub  
**Category:** Web Application / Student Accommodation Platform  
**Backend:** Flask  
**Database:** PostgreSQL  
**Frontend:** HTML, CSS and JavaScript  
**Deployment:** Render

---

## 📄 License

No license is specified here. Add a `LICENSE` file if you intend to publish the project under a particular open-source license.
