# Office Awards – live phone voting (Firebase)

- **index.html** – staff open this on their phone. It waits until the admin opens an award, then shows the nominees. One vote per phone per award.
- **admin.html** – you open this on a laptop. Pick which award is live, edit nominees, watch live results, show a QR code, and present results full screen.

## Setup (about 10 minutes)

1. **Create a project** at https://console.firebase.google.com → Add project.
2. **Add a Web app** (Project settings → General → Your apps → `</>`). Copy the config values into `public/firebase-config.js`.
3. **Authentication → Sign-in method**, enable:
   - **Anonymous** (this gives every phone its own voter ID)
   - **Google** (for the admin login)
4. **Firestore Database → Create database** (production mode, any region).
5. **Set your admin email** in two places:
   - `public/firebase-config.js` → `ADMIN_EMAILS`
   - `firestore.rules` → inside `isAdmin()`
6. **Deploy** (needs Node.js):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy             # deploys rules + hosting
   ```
   You get a URL like `https://your-project.web.app`.
   Admin page: `https://your-project.web.app/admin.html`

## On the day

1. Open `/admin.html`, sign in with the admin Google account.
2. First time only: press **Create default awards** (Best Football Player M/F, Best Dressed M/F, Cutest Girl, Most Handsome Guy).
3. Press **Edit** on each award and type the nominee names, one per line → **Save**.
4. Put the QR code on the big screen; staff scan it and keep the page open.
5. Press **Open** on an award → it appears on every phone instantly. Results update live.
6. When done, open the next award (only one is live at a time) or press **Close voting**.
7. **Present results full screen** shows big bars for the projector.

## How "one vote per phone" works

Each phone signs in anonymously and gets an ID. A vote is saved as `votes/<award>_<phoneId>`, and the security rules allow creating it only once (no updates), only while that award is live, and only for a listed nominee.

Limitation: someone could get a second vote by opening a private/incognito tab or clearing browser data, which creates a new anonymous ID. For a friendly office vote this is usually fine; for stricter control, switch staff sign-in to Google/company accounts.
