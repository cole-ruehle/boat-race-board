(function () {
  const SHEET_CACHE_KEY = "beerDrinkingTimeBoard_sheet_cache_v1";

  function getSheetConfig() {
    const c = window.BDT_CONFIG || {};
    const sheetId = String(c.sheetId || "").trim();
    const gid = String(c.gid != null && c.gid !== "" ? c.gid : "0").trim() || "0";
    return sheetId ? { sheetId, gid } : null;
  }

  function loadSheetCache() {
    try {
      const raw = localStorage.getItem(SHEET_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.people)) return null;
      return {
        people: data.people.map((p, i) => ({
          id: String(p.id || `sheet-row-${i}`),
          name: String(p.name ?? "Participant"),
          image: String(p.image ?? ""),
          time: String(p.time ?? "—"),
          drink: String(p.drink ?? ""),
        })),
        updatedAt: data.updatedAt || Date.now(),
      };
    } catch {
      return null;
    }
  }

  function saveSheetCache(people, updatedAt) {
    try {
      localStorage.setItem(
        SHEET_CACHE_KEY,
        JSON.stringify({ people, updatedAt }),
      );
    } catch {
      /* ignore */
    }
  }

  function buildInitialState() {
    const cached = loadSheetCache();
    return {
      people: cached ? cached.people : [],
      updatedAt: cached ? cached.updatedAt : Date.now(),
    };
  }

  let state = buildInitialState();

  const els = {
    castList: document.getElementById("castList"),
    castEmpty: document.getElementById("castEmpty"),
    lastUpdated: document.getElementById("lastUpdated"),
    btnSyncSheet: document.getElementById("btnSyncSheet"),
    template: document.getElementById("castRowTemplate"),
    sheetBanner: document.getElementById("sheetBanner"),
  };

  function showSheetBanner(message, isError) {
    els.sheetBanner.textContent = message;
    els.sheetBanner.classList.remove("is-hidden");
    els.sheetBanner.classList.toggle("is-error", !!isError);
  }

  function hideSheetBanner() {
    els.sheetBanner.classList.add("is-hidden");
    els.sheetBanner.classList.remove("is-error");
    els.sheetBanner.textContent = "";
  }

  function fetchSheetGviz(sheetId, gid) {
    const cbName = `bdt_gviz_cb_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Sheet request timed out. Check sharing settings (Anyone with the link can view)."));
      }, 20_000);

      function cleanup() {
        clearTimeout(timeoutId);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (resp) => {
        cleanup();
        if (!resp) {
          reject(new Error("Empty response from Google Sheets."));
          return;
        }
        if (resp.status === "error") {
          const msg =
            resp.errors?.[0]?.detailed_message ||
            resp.errors?.[0]?.message ||
            "Could not read spreadsheet.";
          reject(new Error(msg));
          return;
        }
        resolve(resp);
      };

      const script = document.createElement("script");
      const tqx = encodeURIComponent(`out:json;responseHandler:${cbName}`);
      script.src = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=${tqx}&headers=1&gid=${encodeURIComponent(gid)}`;
      script.onerror = () => {
        cleanup();
        reject(new Error("Could not load sheet (blocked or offline)."));
      };
      document.head.appendChild(script);
    });
  }

  function findColIndex(labels, keys) {
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      for (const k of keys) {
        if (L === k || L.includes(k)) return i;
      }
    }
    return -1;
  }

  function cellText(cell) {
    if (!cell) return "";
    if (cell.v != null && cell.v !== "") {
      return String(cell.v).trim();
    }
    if (cell.f != null && cell.f !== "") {
      return String(cell.f).trim();
    }
    return "";
  }

  /** @returns {number|null} seconds for sorting, or null if no comparable time (sorted last) */
  function parseTimeToSeconds(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;

    const compact = s.replace(/\s/g, "");
    if (
      /^n\/a$/i.test(compact) ||
      /^tbd$/i.test(compact) ||
      /^[\-–—\u2013\u2014?]+$/u.test(compact)
    ) {
      return null;
    }

    const minWord = compact.match(/^(\d+(?:\.\d+)?)(?:min(?:ute)?s?|m)$/i);
    if (minWord) {
      return Math.round(parseFloat(minWord[1]) * 60);
    }

    const secWord = compact.match(/^(\d+(?:\.\d+)?)(?:sec(?:ond)?s?|s)$/i);
    if (secWord) {
      return Math.round(parseFloat(secWord[1]));
    }

    const hms = compact.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (hms) {
      const h = parseInt(hms[1], 10);
      const m = parseInt(hms[2], 10);
      const sec = parseInt(hms[3], 10);
      if (m >= 60 || sec >= 60 || Number.isNaN(h + m + sec)) return null;
      return h * 3600 + m * 60 + sec;
    }

    const ms = compact.match(/^(\d+):(\d{1,2})$/);
    if (ms) {
      const a = parseInt(ms[1], 10);
      const b = parseInt(ms[2], 10);
      if (b >= 60 || Number.isNaN(a + b)) return null;
      return a * 60 + b;
    }

    if (/^\d+(\.\d+)?$/.test(compact)) {
      return Math.round(parseFloat(compact));
    }

    return null;
  }

  function sortPeopleByTime(people) {
    return [...people].sort((a, b) => {
      const sa = parseTimeToSeconds(a.time);
      const sb = parseTimeToSeconds(b.time);
      const ra = sa === null ? Number.POSITIVE_INFINITY : sa;
      const rb = sb === null ? Number.POSITIVE_INFINITY : sb;
      if (ra !== rb) return ra - rb;
      return String(a.name).localeCompare(String(b.name), undefined, {
        sensitivity: "base",
      });
    });
  }

  function gvizToPeople(resp) {
    const table = resp.table;
    if (!table || !Array.isArray(table.cols)) return [];

    const labels = table.cols.map((c) =>
      String(c.label || "").trim().toLowerCase(),
    );

    let nameIdx = findColIndex(labels, ["name"]);
    let imageIdx = findColIndex(labels, ["image", "photo", "picture", "avatar"]);
    let timeIdx = findColIndex(labels, ["time"]);
    let usedPositionalFallback = false;

    if (nameIdx < 0 || timeIdx < 0) {
      if (table.cols.length >= 3) {
        nameIdx = 0;
        imageIdx = 1;
        timeIdx = 2;
        usedPositionalFallback = true;
      } else if (table.cols.length >= 2) {
        nameIdx = 0;
        imageIdx = -1;
        timeIdx = 1;
        usedPositionalFallback = true;
      } else {
        return [];
      }
    }

    let drinkIdx = findColIndex(labels, ["drink", "beverage", "liquid"]);
    if (drinkIdx < 0 && usedPositionalFallback && table.cols.length >= 4) {
      drinkIdx = 3;
    }

    const people = [];
    const rows = table.rows || [];
    rows.forEach((row, i) => {
      const cells = row.c || [];
      const name = cellText(cells[nameIdx]);
      const image =
        imageIdx >= 0 ? cellText(cells[imageIdx]) : "";
      const timeRaw = cellText(cells[timeIdx]);
      const time = timeRaw || "—";
      const drinkRaw = drinkIdx >= 0 ? cellText(cells[drinkIdx]) : "";
      if (!name) return;
      people.push({
        id: `sheet-row-${i}`,
        name,
        image,
        time,
        drink: drinkRaw,
      });
    });
    return people;
  }

  function syncFromSheet() {
    const cfg = getSheetConfig();
    if (!cfg) return Promise.resolve(false);

    els.lastUpdated.textContent = "Loading…";

    return fetchSheetGviz(cfg.sheetId, cfg.gid)
      .then((data) => {
        const people = gvizToPeople(data);
        state.people = people;
        state.updatedAt = Date.now();
        saveSheetCache(state.people, state.updatedAt);
        hideSheetBanner();
        return true;
      })
      .catch((err) => {
        showSheetBanner(err.message || String(err), true);
        return false;
      });
  }

  function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** @returns {{ kind: string, label: string }} */
  function normalizeDrink(raw) {
    const s = String(raw ?? "").trim();
    if (!s) {
      return { kind: "none", label: "—" };
    }
    const lower = s.toLowerCase();
    if (/^[\-–—\u2013\u2014?]+$/u.test(lower) || /^n\/a$/i.test(lower)) {
      return { kind: "none", label: "—" };
    }
    if (/\bwater\b|h2o|\bagua\b/.test(lower)) {
      return { kind: "water", label: "Water" };
    }
    if (
      /\bbeer\b|\bbrew\b|\blager\b|\bale\b|\bipa\b|\bstout\b|\bpilsner\b|\bpils\b/.test(
        lower,
      )
    ) {
      return { kind: "beer", label: "Beer" };
    }
    return { kind: "other", label: s };
  }

  function syncPhotoWrap(img, wrap, fallbackEl, displayName) {
    const src = img.getAttribute("src") ? img.getAttribute("src").trim() : "";
    fallbackEl.textContent = initials(displayName());
    if (!src) {
      wrap.classList.add("is-empty");
      return;
    }
    wrap.classList.remove("is-empty");
  }

  function renderPerson(person) {
    const node = els.template.content.cloneNode(true);
    const li = node.querySelector(".cast-card");
    li.dataset.id = person.id;

    const img = node.querySelector(".cast-card__photo");
    const wrap = node.querySelector(".cast-card__photo-wrap");
    const fallback = node.querySelector(".cast-card__photo-fallback");
    const nameEl = node.querySelector(".cast-card__name");
    const drinkBadge = node.querySelector(".cast-card__drink-badge");
    const timeEl = node.querySelector(".cast-card__time-value");

    nameEl.textContent = person.name;
    const drink = normalizeDrink(person.drink);
    drinkBadge.textContent = drink.label;
    drinkBadge.classList.add("cast-card__drink-badge--" + drink.kind);
    timeEl.textContent = person.time;
    img.alt = `Photo of ${person.name}`;
    if (person.image) img.src = person.image;
    else img.removeAttribute("src");

    const getName = () => person.name;

    img.addEventListener("load", () => {
      wrap.classList.remove("is-empty");
    });
    img.addEventListener("error", () => {
      wrap.classList.add("is-empty");
      fallback.textContent = initials(getName());
    });

    syncPhotoWrap(img, wrap, fallback, getName);
    return li;
  }

  function refreshUpdatedLabel() {
    const d = new Date(state.updatedAt || Date.now());
    els.lastUpdated.textContent = d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function renderAll() {
    els.castList.innerHTML = "";
    const cfg = getSheetConfig();

    if (!cfg) {
      els.castEmpty.hidden = false;
      els.castEmpty.textContent =
        "No spreadsheet configured. Set sheetId in config.js (see SETUP.md), deploy, and reload.";
      els.btnSyncSheet.classList.add("is-hidden");
      els.lastUpdated.textContent = "—";
      showSheetBanner(
        "Add your Google Sheet id to config.js and ensure the sheet is shared as “Anyone with the link can view.”",
        true,
      );
      return;
    }

    els.btnSyncSheet.classList.remove("is-hidden");

    const empty = state.people.length === 0;
    els.castEmpty.hidden = !empty;
    if (empty) {
      els.castEmpty.textContent =
        "No rows in the sheet yet. Add data (headers: Name, Image, Time, Drink), then click Refresh sheet.";
    }

    for (const p of sortPeopleByTime(state.people)) {
      els.castList.appendChild(renderPerson(p));
    }
    refreshUpdatedLabel();
  }

  els.btnSyncSheet.addEventListener("click", () => {
    syncFromSheet().finally(() => renderAll());
  });

  renderAll();

  if (getSheetConfig()) {
    syncFromSheet().finally(() => renderAll());
  }
})();
