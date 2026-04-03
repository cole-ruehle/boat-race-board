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

## Google Sheet (required, no API keys)

The site **only displays** rows from your spreadsheet; all editing happens in **Google Sheets**.

### 1. Create the sheet

- Row **1** must be headers (any column order is fine):

  | Name | Image | Time | Drink |
  |------|-------|------|-------|
  | Jordan Lee | https://example.com/photo.jpg | 0:45 | beer |

- **Name** — display name  
- **Image** — `https://…` link to a photo, or a short JPEG **data URL** pasted into the cell (cells are limited to about 50,000 characters)  
- **Time** — any text (e.g. `1:12`, `45 min`); used for sorting (shortest first). **Decimals = minutes:** `2.5` means 2 minutes 30 seconds (also how Google Sheets often stores a number like `2.5`). Plain integers like `45` or `120` are treated as **seconds**.  
- **Drink** — column header **Drink**, **Beverage**, or **Liquid**. Put **water** or **beer** (wording is flexible: e.g. `IPA`, `lager`, `H2O` still classify). Leave empty if unknown.

If you use the default column order **Name · Image · Time · Drink** with no matching header names, the fourth column is read as drink.

Add one data row per person. Other columns are ignored unless they are the only unnamed extra column (prefer using a **Drink** header).

### Several people editing

Use **one** sheet and add **Editors** via Share → invite Google accounts. The page only **reads** the sheet when it loads or when someone clicks **Refresh sheet**:

- Editors change the sheet while signed into Google.
- Viewers use your site **without** logging in; the sheet must allow **Anyone with the link can view** (or broader) so the page can read it.

### 2. Share the sheet

**Share → General access → Anyone with the link → Viewer** (minimum for the public page to load). Give **Editor** to people who should change the board.

### 3. Point `config.js` at the sheet

1. Copy the spreadsheet **id** from the URL:  
   `https://docs.google.com/spreadsheets/d/`**`1abc...xyz`**`/edit`
2. For the correct **tab**, note **gid** in the URL (`gid=…`; first tab is often `0`).

```js
window.BDT_CONFIG = {
  sheetId: "1abc...xyz",
  gid: "0",
};
```

3. Commit and push. Use **Refresh sheet** on the site to pull the latest.

If `sheetId` is missing, the page shows a configuration message instead of a leaderboard.

### Limits

- **Display-only:** the static site does not write to Google. Update the sheet in Drive, then refresh.
- **No API keys:** public spreadsheet id + link-based viewing only.
