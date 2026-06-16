# AccessLink

Crowdsourced accessibility map and itinerary planner — built for hackathons with **HTML/CSS/Bootstrap**, **Vanilla JS**, **Leaflet.js**, **Node.js/Express**, and **PostgreSQL**.

## What it does

- **Interactive map** — Leaflet markers with accessibility tags (wheelchair, elevator, braille, quiet room, sign language, restrooms)
- **Filter by disability type** — mobility, vision, hearing
- **Crowdsourced reports** — submit updates with optional photo upload
- **Itinerary planner** — personalized accessible stops based on your profile
- **"I'm Stuck" emergency help** — notifies nearby volunteers via email/SMS (when configured)
- **Venue dashboard** — business owners claim locations and update accessibility
- **Accessibility extras** — high contrast, large text, TTS, voice commands, PWA shell

## Quick start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [PostgreSQL](https://www.postgresql.org/) locally, or a free [Supabase](https://supabase.com/) project

### 2. Install

```bash
cd AccessLink
npm install
```

### 3. Configure environment

```bash
copy .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Random secret for auth tokens |
| `SMTP_*` | No | Email for emergency alerts (logs to console if missing) |
| `TWILIO_*` | No | SMS for emergency alerts (logs to console if missing) |

**Example local DATABASE_URL:**
```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/accesslink
```

Create the database first:
```sql
CREATE DATABASE accesslink;
```

### 4. Initialize database

```bash
npm run db:setup
```

### 5. Run

```bash
npm start
```

Open **http://localhost:3000**

### Demo accounts (after db:setup)

| Email | Password | Role |
|-------|----------|------|
| demo@accesslink.app | password123 | User |
| owner@cafe.com | password123 | Venue owner |
| volunteer@accesslink.app | password123 | Volunteer |

## Project structure

```
AccessLink/
├── server/           # Express API
│   ├── routes/       # auth, locations, reports, itinerary, emergency, venues
│   ├── middleware/   # JWT auth
│   └── services/     # email (Nodemailer), SMS (Twilio)
├── database/         # schema.sql, setup.js
├── public/           # Frontend (HTML/CSS/JS)
│   ├── js/
│   ├── css/
│   └── uploads/      # Report photos
└── package.json
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/locations` | List/filter locations |
| POST | `/api/reports` | Submit report (+ photo) |
| POST | `/api/itinerary/plan` | Plan accessible trip |
| POST | `/api/emergency/help` | Send "I'm stuck" alert |
| GET | `/api/venues/my-locations` | Venue dashboard |

## Deployment

- **Backend:** [Render](https://render.com) or [Railway](https://railway.app) — set `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`
- **Database:** [Supabase](https://supabase.com) free Postgres
- Run `npm run db:setup` once against production DB

## Customization

- Change default map center in `public/js/map.js` (`DEFAULT_CENTER`) to your city
- Add sample locations in `database/setup.js`
- Enable real email/SMS by filling SMTP and Twilio vars in `.env`

## License

MIT
