# Beer Drinking Time board — setup

## Run locally

From the project folder in a terminal:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

If you prefer Node:

```bash
npx --yes serve -p 8080
```

Use a local server (not `file://`) so `config.js` and `app.js` load reliably.

## Deploy on GitHub Pages (no secrets)

1. **Create an empty repository** on GitHub (no README license template needed), e.g. `boat-race-board`. Note the repo URL GitHub shows.

2. **From your project folder**, commit and push (first time):

   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "Initial site"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

   Include at least: `index.html`, `styles.css`, `app.js`, `config.js`, and this file if you want docs online.

3. **Turn on Pages:** on GitHub open the repo → **Settings** → **Pages** (left sidebar).

4. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Choose branch **`main`** and folder **`/` (root)** → **Save**.

5. Wait one or two minutes. The site URL is shown at the top of the Pages settings page, usually:

   `https://YOUR_USERNAME.github.io/YOUR_REPO/`

Optional: if you use a **private** repo, GitHub still serves Pages on free accounts with the same URL; viewers only see the published site, not the repo.

No GitHub secrets, Actions, or build step are required—static files only.

## Google Sheet (optional, still no API keys)

The site can **read** rows from a spreadsheet using Google’s public visualization endpoint. **Editing still happens in Google Sheets** (or you can leave `sheetId` empty and use only the in-browser editor + local storage).

### 1. Create the sheet

- Row **1** must be headers. Use exactly these labels (any column order is fine):

  | Name | Image | Time |
  |------|-------|------|
  | Jordan Lee | https://example.com/photo.jpg | 0:45 |

- **Name** — display name  
- **Image** — `https://…` link to a photo, **or** a short JPEG data URL pasted from the board’s **Portrait file** upload (see below)  
- **Time** — any text you like (e.g. `1:12`, `45 min`)

Add one data row per person. Extra columns are ignored.

### Several people editing times

Use **one** Google Sheet and add everyone who should change scores as **Editors** (Share → invite their Google accounts). The website does **not** push live updates; it only **reads** the sheet when someone opens the page or clicks **Refresh sheet**. So:

- Editors change cells in Google Sheets (they stay logged into Google).
- Viewers open your GitHub Pages site **without** any Google login; the sheet must stay **Anyone with the link can view** (or “Anyone on the internet”) so that read works.
- After an editor saves the sheet, others see new times after **Refresh sheet** or a normal reload.

That is the “unauthenticated” part: **anonymous read** from the static site, not anonymous **write** (writes always happen in Google Sheets with normal Google permissions).

### Images without an image host

- **Easiest:** put an `https://` URL in the **Image** column (any normal image link).
- **Upload from the board (sheet mode):** unlock **Staff edit**, choose **Portrait file** for a row. The site compresses the photo and copies a **data URL** to your clipboard (or leaves it in the Image field). **Paste that into the Image cell** for that person in Google Sheets, save the sheet, then click **Refresh sheet**. Cells are limited to about **50,000 characters**, so very large originals may fail until you use a smaller file or a URL instead.
- **Local-only mode** (no `sheetId` in `config.js`): uploads save in this browser’s storage with no Google involved.

### 2. Share the sheet

**Share → General access → Anyone with the link → Viewer** (or Editor for people who can change the board).  
Without this, the public page cannot read the sheet.

### 3. Point `config.js` at the sheet

1. Open the spreadsheet. Copy the **spreadsheet ID** from the URL:

   `https://docs.google.com/spreadsheets/d/`**`1abc...xyz`**`/edit`

2. Open the **tab** that has your table. Copy the **gid** from the URL if present (`gid=123456789`). The first tab often uses `gid=0`.

3. Edit `config.js` in this repo:

   ```js
   window.BDT_CONFIG = {
     sheetId: "1abc...xyz",
     gid: "0",
   };
   ```

4. Commit and push. After GitHub Pages rebuilds, use **Refresh sheet** on the site (or reload the page).

### Limits and expectations

- **Read-only from the site:** the HTML app does not call the Sheets API or push rows automatically. You update cells in Google Drive (or paste image data from the upload helper), then refresh the board.
- **No API keys:** only a public spreadsheet id in `config.js` and a sheet that allows link-based viewing.
- **`sheetId` set:** names, times, and images come from the sheet; password unlocks staff tools (open sheet, image upload → clipboard, refresh).
- **Automatic write-back** from the website (no copy-paste) would need Google Apps Script or the Sheets API with credentials—not included here.

## Passphrase

Staff unlock uses the passphrase baked into `app.js` (`407mem`). Anyone can see it in the source; use it for casual friends-only gating, not real security.
