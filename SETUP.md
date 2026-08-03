# Treasure Hunt — Setup Guide (Firebase)

## What you're getting

A full-stack real-world treasure hunt web app:
- Players sign up, join hunts, and find clues in **any order** (open world)
- Four clue types: **text riddle**, **GPS location**, **photo proof**, **QR code**
- **Live leaderboard** powered by Firestore `onSnapshot` — updates instantly
- Admin panel to create hunts, add clues, and download printable QR codes

---

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → Add project
2. Give it a name, skip Google Analytics if you like
3. In your project dashboard, click **Add app** → Web `</>` → register the app
4. Copy the `firebaseConfig` values — you'll need them in step 3

---

## 2. Enable Firebase services

In the Firebase console, enable these three services:

**Authentication**
- Build → Authentication → Get started
- Sign-in method → Email/Password → Enable

**Firestore**
- Build → Firestore Database → Create database
- Choose **Start in production mode** (we'll add rules next)
- Pick a region close to your players

**Storage**
- Build → Storage → Get started
- Choose production mode, same region as Firestore

---

## 3. Add Firestore security rules

1. Firestore → Rules tab
2. Replace the default rules with the contents of `firestore.rules`
3. Click Publish

---

## 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Firebase config values:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

---

## 5. Install and run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`

---

## 6. Make yourself an admin

After signing up in the app:

1. Go to Firebase console → Firestore → `profiles` collection
2. Find your document (it's named with your user ID)
3. Edit the `isAdmin` field → set to `true`

Refresh the app — you'll see the **Admin** link in the nav.

---

## 7. Create your first hunt

1. Admin → **+ New hunt** → fill in title and optional dates
2. Switch to **Clues** tab and add clues:
   - **Text riddle**: write the riddle + the correct answer (matched case-insensitively)
   - **GPS**: paste lat/lng from Google Maps (long-press → copy coordinates) + set radius in meters
   - **Photo**: players submit a photo stored in Firebase Storage
   - **QR**: a QR code is generated automatically — download and print it, then tape it at the location
3. The hunt is active by default

---

## 8. Deploy

```bash
npm run build
```

Deploy the `dist/` folder:

- **Firebase Hosting** (recommended — same project): `npm install -g firebase-tools && firebase init hosting && firebase deploy`
- **Vercel**: `npx vercel` (add env vars in Vercel dashboard)
- **Netlify**: drag `dist/` into Netlify drop

---

## Data structure (Firestore)

```
profiles/
  {userId}/         username, isAdmin, createdAt

hunts/
  {huntId}/         title, description, isActive, startsAt, endsAt, createdBy, createdAt
    clues/
      {clueId}/     title, riddle, clueType, answer?, lat?, lng?, gpsRadiusMeters?, qrToken?, displayOrder, points

playerProgress/
  {progressId}/     playerId, username, huntId, clueId, points, photoUrl?, completedAt
```

---

## Clue types

| Type | How it works |
|------|-------------|
| Text riddle | Player types the answer; matched case-insensitively against the stored answer |
| GPS | Player must be within N meters of the target coordinates (uses browser geolocation) |
| Photo | Player takes/uploads a photo; stored in Firebase Storage for admin review |
| QR code | Player scans a QR code placed at the location, or enters the token manually |

---

## Troubleshooting

**Sign-up fails** — make sure Email/Password auth is enabled in Firebase console.

**"Missing or insufficient permissions"** — double-check the Firestore rules are published correctly.

**GPS not working** — requires HTTPS in production. Works on `localhost` for testing.

**Camera not opening for QR** — iOS Safari requires HTTPS. Deploy or use `npx localtunnel` for mobile testing.

**Leaderboard not updating** — confirm Firestore is in Native mode (not Datastore mode); `onSnapshot` requires Native mode.
