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
  let drinkFilter = "all";

  const els = {
    castList: document.getElementById("castList"),
    castEmpty: document.getElementById("castEmpty"),
    lastUpdated: document.getElementById("lastUpdated"),
    btnSyncSheet: document.getElementById("btnSyncSheet"),
    openSheetLink: document.getElementById("openSheetLink"),
    drinkFilterBar: document.getElementById("drinkFilter"),
    template: document.getElementById("castRowTemplate"),
    tierTemplate: document.getElementById("castTierTemplate"),
    sheetBanner: document.getElementById("sheetBanner"),
    estimateModal: document.getElementById("estimateModal"),
    estimateModalBody: document.getElementById("estimateModalBody"),
    estimateModalTotal: document.getElementById("estimateModalTotal"),
    estimateModalClose: document.getElementById("estimateModalClose"),
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

  function updateSheetLink() {
    const link = els.openSheetLink;
    if (!link) return;
    const cfg = getSheetConfig();
    if (cfg && cfg.sheetId) {
      const sid = encodeURIComponent(cfg.sheetId);
      const gid = encodeURIComponent(cfg.gid);
      link.href = `https://docs.google.com/spreadsheets/d/${sid}/edit#gid=${gid}`;
      link.setAttribute("aria-disabled", "false");
      link.classList.remove("is-hidden");
    } else {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
      link.classList.add("is-hidden");
    }
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

    const compactNorm = compact.replace(",", ".");
    // Decimal = decimal minutes (e.g. 2.5 → 2 min 30 sec). Matches Sheets numeric cells like 2.5.
    if (/^\d+\.\d+$/.test(compactNorm)) {
      return Math.round(parseFloat(compactNorm) * 60);
    }

    if (/^\d+$/.test(compactNorm)) {
      return parseInt(compactNorm, 10);
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

  function drinkKindForFilter(person) {
    return normalizeDrink(person.drink).kind;
  }

  function getFilteredSortedPeople() {
    const sorted = sortPeopleByTime(state.people);
    if (drinkFilter === "all") return sorted;
    return sorted.filter((p) => {
      const k = drinkKindForFilter(p);
      if (drinkFilter === "water") return k === "water";
      if (drinkFilter === "beer") return k === "beer";
      if (drinkFilter === "other") return k === "other" || k === "none";
      return true;
    });
  }

  function createTierRow(title, subtitle, estimateInfo) {
    const node = els.tierTemplate.content.cloneNode(true);
    const li = node.querySelector(".cast-tier");
    li.querySelector(".cast-tier__title").textContent = title;
    const sub = li.querySelector(".cast-tier__sub");
    sub.textContent = subtitle || "";
    sub.hidden = !subtitle;
    const est = li.querySelector(".cast-tier__estimate");
    const line = estimateInfo && estimateInfo.text ? estimateInfo.text : "";
    const breakdown = estimateInfo && estimateInfo.breakdown;
    est.textContent = line;
    est.classList.toggle("is-hidden", !line);
    if (line && breakdown) {
      est.setAttribute(
        "aria-label",
        "Show full breakdown for 1 v combined estimate in minutes and seconds",
      );
      est.addEventListener("click", () => openEstimateModal(breakdown));
    } else {
      est.removeAttribute("aria-label");
    }
    return li;
  }

  /** Always minutes + seconds, e.g. 0m 45s, 12m 0s */
  function formatMinutesSecondsAlways(totalSec) {
    if (!Number.isFinite(totalSec) || totalSec <= 0) return "—";
    const s = Math.round(totalSec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }

  function closeEstimateModal() {
    if (els.estimateModal) els.estimateModal.hidden = true;
  }

  function openEstimateModal(breakdown) {
    if (!els.estimateModal || !els.estimateModalBody || !breakdown) return;
    const totalRounded = Math.round(breakdown.totalSeconds);
    els.estimateModalTotal.textContent =
      `Total: ${formatMinutesSecondsAlways(breakdown.totalSeconds)} (${totalRounded} seconds)`;
    els.estimateModalBody.innerHTML = "";
    const table = document.createElement("table");
    table.className = "estimate-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    ["#", "Name", "Sheet time", "Parsed", "Drink", "Factor", "Adds"].forEach(
      (label) => {
        const th = document.createElement("th");
        th.textContent = label;
        hr.appendChild(th);
      },
    );
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = document.createElement("tbody");
    for (const r of breakdown.rows) {
      const tr = document.createElement("tr");
      if (r.skipped) tr.classList.add("row--skipped");

      const tdRank = document.createElement("td");
      tdRank.textContent = String(r.rank);
      tr.appendChild(tdRank);

      const tdName = document.createElement("td");
      tdName.textContent = r.name;
      tr.appendChild(tdName);

      const tdSheet = document.createElement("td");
      tdSheet.textContent = r.timeSheet;
      tr.appendChild(tdSheet);

      const tdParsed = document.createElement("td");
      tdParsed.className = "num";
      tdParsed.textContent =
        r.parsedSeconds !== null ? `${r.parsedSeconds}s` : "—";
      tr.appendChild(tdParsed);

      const tdDrink = document.createElement("td");
      tdDrink.textContent = r.drinkLabel;
      tr.appendChild(tdDrink);

      const tdFact = document.createElement("td");
      tdFact.className = "num";
      tdFact.textContent = r.skipped ? "—" : `×${r.drinkFactor}`;
      tr.appendChild(tdFact);

      const tdAdds = document.createElement("td");
      tdAdds.className = "num";
      if (!r.skipped && r.contribution !== null) {
        tdAdds.appendChild(
          document.createTextNode(
            formatMinutesSecondsAlways(r.contribution),
          ),
        );
        const sub = document.createElement("div");
        sub.className = "formula";
        sub.textContent = `2 × ${r.parsedSeconds}s × ${r.drinkFactor}`;
        tdAdds.appendChild(sub);
      } else {
        tdAdds.textContent = "—";
      }
      tr.appendChild(tdAdds);

      tb.appendChild(tr);
    }
    table.appendChild(tb);
    els.estimateModalBody.appendChild(table);
    els.estimateModal.hidden = false;
  }

  /** Beer baseline; water, other, and missing drink get the penalty multiplier. */
  function estimateMultiplierForTop8(kind) {
    if (kind === "beer") return 1;
    return 1.2;
  }

  /** Top 8 in current (filtered) order: Σ (2 × seconds × drink factor), with per-row breakdown. */
  function computeTop8EstimatedBreakdown(sortedList) {
    const TOP_N = 8;
    let totalSeconds = 0;
    const rows = [];
    const n = Math.min(TOP_N, sortedList.length);
    for (let i = 0; i < n; i++) {
      const p = sortedList[i];
      const drink = normalizeDrink(p.drink);
      const sec = parseTimeToSeconds(p.time);
      if (sec === null) {
        rows.push({
          rank: i + 1,
          name: p.name,
          timeSheet: p.time,
          parsedSeconds: null,
          drinkLabel: drink.label,
          drinkFactor: estimateMultiplierForTop8(drink.kind),
          contribution: null,
          skipped: true,
        });
        continue;
      }
      const factor = estimateMultiplierForTop8(drink.kind);
      const contribution = 2 * sec * factor;
      totalSeconds += contribution;
      rows.push({
        rank: i + 1,
        name: p.name,
        timeSheet: p.time,
        parsedSeconds: sec,
        drinkLabel: drink.label,
        drinkFactor: factor,
        contribution,
        skipped: false,
      });
    }
    return { totalSeconds, rows };
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

  function renderPerson(person, options) {
    const { isTurn = false } = options || {};
    const node = els.template.content.cloneNode(true);
    const li = node.querySelector(".cast-card");
    li.dataset.id = person.id;
    const spotlight = node.querySelector(".cast-card__spotlight");
    if (isTurn) {
      li.classList.add("cast-card--turn");
      spotlight.hidden = false;
    } else {
      spotlight.hidden = true;
    }

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
    updateSheetLink();
    els.castList.innerHTML = "";
    const cfg = getSheetConfig();

    if (!cfg) {
      els.castEmpty.hidden = false;
      els.castEmpty.textContent =
        "No spreadsheet configured. Set sheetId in config.js (see SETUP.md), deploy, and reload.";
      els.btnSyncSheet.classList.add("is-hidden");
      els.drinkFilterBar.classList.add("is-hidden");
      els.lastUpdated.textContent = "—";
      showSheetBanner(
        "Add your Google Sheet id to config.js and ensure the sheet is shared as “Anyone with the link can view.”",
        true,
      );
      return;
    }

    els.btnSyncSheet.classList.remove("is-hidden");
    els.drinkFilterBar.classList.remove("is-hidden");

    const list = getFilteredSortedPeople();
    const emptyAll = state.people.length === 0;
    const emptyFilter = !emptyAll && list.length === 0;

    els.castEmpty.hidden = !emptyAll && !emptyFilter;
    if (emptyAll) {
      els.castEmpty.textContent =
        "No rows in the sheet yet. Add data (headers: Name, Image, Time, Drink), then click Refresh sheet.";
    } else if (emptyFilter) {
      els.castEmpty.textContent =
        "No one matches this drink filter. Try All or another option.";
    }

    const turnPerson =
      list.find((p) => parseTimeToSeconds(p.time) !== null) || null;
    const turnId = turnPerson ? turnPerson.id : null;

    const TOP_N = 8;
    const estBreakdown = computeTop8EstimatedBreakdown(list);
    const estTotal = estBreakdown.totalSeconds;
    const estLine =
      estTotal > 0
        ? `Est. combined ${formatMinutesSecondsAlways(estTotal)} · breakdown`
        : "";

    list.forEach((p, i) => {
      if (i === 0) {
        els.castList.appendChild(
          createTierRow("1 v", "Top " + TOP_N, {
            text: estLine,
            breakdown: estTotal > 0 ? estBreakdown : null,
          }),
        );
      }
      if (i === TOP_N && list.length > TOP_N) {
        els.castList.appendChild(createTierRow("The field", "Everyone else"));
      }
      els.castList.appendChild(
        renderPerson(p, { isTurn: turnId !== null && p.id === turnId }),
      );
    });

    refreshUpdatedLabel();
  }

  els.drinkFilterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".drink-filter__btn");
    if (!btn || !btn.dataset.filter) return;
    drinkFilter = btn.dataset.filter;
    els.drinkFilterBar.querySelectorAll(".drink-filter__btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.filter === drinkFilter);
    });
    renderAll();
  });

  els.btnSyncSheet.addEventListener("click", () => {
    syncFromSheet().finally(() => renderAll());
  });

  if (els.estimateModalClose) {
    els.estimateModalClose.addEventListener("click", closeEstimateModal);
  }
  if (els.estimateModal) {
    els.estimateModal.addEventListener("click", (e) => {
      if (e.target === els.estimateModal) closeEstimateModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.estimateModal && !els.estimateModal.hidden) {
      closeEstimateModal();
    }
  });

  renderAll();

  if (getSheetConfig()) {
    syncFromSheet().finally(() => renderAll());
  }

  (function initHeroVideo() {
    const v = document.querySelector(".title-block__poster-video");
    const fb = document.getElementById("heroPosterFallback");
    if (!v) return;
    v.addEventListener("error", () => {
      v.classList.add("is-hidden");
      if (fb) fb.classList.remove("is-hidden");
    });
    v.play().catch(() => {
      /* Autoplay may require a user gesture in some browsers; video still loops when played. */
    });
  })();
})();
