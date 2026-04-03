(function () {
  const STORAGE_KEY = "beerDrinkingTimeBoard_v1";
  const SHEET_CACHE_KEY = "beerDrinkingTimeBoard_sheet_cache_v1";
  const SESSION_EDIT = "bdt_edit_unlocked";
  const PASSWORD = "407mem";

  function getSheetConfig() {
    const c = window.BDT_CONFIG || {};
    const sheetId = String(c.sheetId || "").trim();
    const gid = String(c.gid != null && c.gid !== "" ? c.gid : "0").trim() || "0";
    return sheetId ? { sheetId, gid } : null;
  }

  const defaultPeople = () => [
    { id: crypto.randomUUID(), name: "Jordan Lee", image: "", time: "0:45" },
    { id: crypto.randomUUID(), name: "Sam Ortiz", image: "", time: "1:12" },
    { id: crypto.randomUUID(), name: "Riley Chen", image: "", time: "0:38" },
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { people: defaultPeople(), updatedAt: Date.now() };
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data.people)) {
        return { people: defaultPeople(), updatedAt: Date.now() };
      }
      return {
        people: data.people.map((p) => ({
          id: p.id || crypto.randomUUID(),
          name: String(p.name ?? "Participant"),
          image: String(p.image ?? ""),
          time: String(p.time ?? "—"),
        })),
        updatedAt: data.updatedAt || Date.now(),
      };
    } catch {
      return { people: defaultPeople(), updatedAt: Date.now() };
    }
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

  function saveState(state) {
    if (getSheetConfig()) return;
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function buildInitialState() {
    if (getSheetConfig()) {
      const cached = loadSheetCache();
      return {
        people: cached ? cached.people : [],
        updatedAt: cached ? cached.updatedAt : Date.now(),
      };
    }
    return loadState();
  }

  let state = buildInitialState();

  const els = {
    castList: document.getElementById("castList"),
    castEmpty: document.getElementById("castEmpty"),
    lastUpdated: document.getElementById("lastUpdated"),
    btnEdit: document.getElementById("btnEdit"),
    btnSyncSheet: document.getElementById("btnSyncSheet"),
    passwordModal: document.getElementById("passwordModal"),
    passwordForm: document.getElementById("passwordForm"),
    passwordInput: document.getElementById("passwordInput"),
    passwordError: document.getElementById("passwordError"),
    modalCancel: document.getElementById("modalCancel"),
    template: document.getElementById("castRowTemplate"),
    editToolbar: document.getElementById("editToolbar"),
    addPerson: document.getElementById("addPerson"),
    openSheetLink: document.getElementById("openSheetLink"),
    editToolbarHint: document.getElementById("editToolbarHint"),
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

  function gvizToPeople(resp) {
    const table = resp.table;
    if (!table || !Array.isArray(table.cols)) return [];

    const labels = table.cols.map((c) =>
      String(c.label || "").trim().toLowerCase(),
    );

    let nameIdx = findColIndex(labels, ["name"]);
    let imageIdx = findColIndex(labels, ["image", "photo", "picture", "avatar"]);
    let timeIdx = findColIndex(labels, ["time"]);

    if (nameIdx < 0 || timeIdx < 0) {
      if (table.cols.length >= 3) {
        nameIdx = 0;
        imageIdx = 1;
        timeIdx = 2;
      } else if (table.cols.length >= 2) {
        nameIdx = 0;
        imageIdx = -1;
        timeIdx = 1;
      } else {
        return [];
      }
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
      if (!name) return;
      people.push({
        id: `sheet-row-${i}`,
        name,
        image,
        time,
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

  function updateShellUi() {
    const cfg = getSheetConfig();
    document.body.classList.toggle("sheet-mode", !!cfg);
    els.btnSyncSheet.classList.toggle("is-hidden", !cfg);

    if (cfg) {
      els.openSheetLink.href = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`;
      els.editToolbarHint.textContent =
        "One shared spreadsheet is the source of truth. Editors change it in Google (while signed in); the site reads it anonymously. Use Refresh sheet to pull the latest times and images.";
    } else {
      els.openSheetLink.href = "#";
      els.editToolbarHint.textContent = "Changes save in this browser.";
    }

    const editOn = document.body.classList.contains("edit-mode");
    els.openSheetLink.classList.toggle("is-hidden", !(editOn && cfg));
  }

  function setEditMode(on) {
    document.body.classList.toggle("edit-mode", on);
    els.editToolbar.classList.toggle("is-hidden", !on);
    els.btnEdit.textContent = on ? "Lock board" : "Staff edit";
    els.btnEdit.classList.toggle("is-unlocked", on);
    els.btnEdit.setAttribute("aria-expanded", String(on));
    updateShellUi();
  }

  function isEditUnlocked() {
    return sessionStorage.getItem(SESSION_EDIT) === "1";
  }

  function openPasswordModal() {
    els.passwordModal.hidden = false;
    els.passwordError.hidden = true;
    els.passwordInput.value = "";
    els.passwordInput.focus();
  }

  function closePasswordModal() {
    els.passwordModal.hidden = true;
  }

  /** Resize & JPEG-compress so a data URL can fit in a Google Sheets cell (~50k chars). */
  function fileToCompressedDataUrl(file, maxEdge, qualityStart, maxChars) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Choose an image file."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.onload = () => {
        const bitmap = reader.result;
        const image = new Image();
        image.onload = () => {
          try {
            let w = image.naturalWidth;
            let h = image.naturalHeight;
            if (!w || !h) {
              reject(new Error("Invalid image dimensions."));
              return;
            }
            const scale = Math.min(1, maxEdge / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Could not process image in this browser."));
              return;
            }
            ctx.drawImage(image, 0, 0, w, h);

            let q = qualityStart;
            let dataUrl = canvas.toDataURL("image/jpeg", q);
            while (dataUrl.length > maxChars && q > 0.38) {
              q -= 0.08;
              dataUrl = canvas.toDataURL("image/jpeg", q);
            }
            if (dataUrl.length > maxChars) {
              reject(
                new Error(
                  "Image is still too large for a sheet cell after compressing. Use a smaller picture or an https:// image link instead.",
                ),
              );
              return;
            }
            resolve(dataUrl);
          } catch (e) {
            reject(
              new Error(
                "Could not convert that image (try JPG or PNG).",
              ),
            );
          }
        };
        image.onerror = () => reject(new Error("Could not load image data."));
        image.src = bitmap;
      };
      reader.readAsDataURL(file);
    });
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
    const timeEl = node.querySelector(".cast-card__time-value");
    const nameInput = node.querySelector(".edit-name");
    const imageInput = node.querySelector(".edit-image");
    const imageFileInput = node.querySelector(".edit-image-file");
    const timeInput = node.querySelector(".edit-time");
    const removeBtn = node.querySelector(".cast-remove");

    nameEl.textContent = person.name;
    timeEl.textContent = person.time;
    img.alt = `Photo of ${person.name}`;
    if (person.image) img.src = person.image;
    else img.removeAttribute("src");
    nameInput.value = person.name;
    imageInput.value = person.image;
    timeInput.value = person.time;

    const getName = () =>
      getSheetConfig() ? person.name : nameInput.value || person.name;

    function refreshPersonDom() {
      nameEl.textContent = person.name;
      timeEl.textContent = person.time;
      img.alt = `Photo of ${person.name}`;
      if (person.image) img.src = person.image;
      else img.removeAttribute("src");
      syncPhotoWrap(img, wrap, fallback, getName);
    }

    img.addEventListener("load", () => {
      wrap.classList.remove("is-empty");
    });
    img.addEventListener("error", () => {
      wrap.classList.add("is-empty");
      fallback.textContent = initials(getName());
    });

    syncPhotoWrap(img, wrap, fallback, getName);

    nameInput.addEventListener("input", () => {
      if (getSheetConfig()) return;
      person.name = nameInput.value.trim() || "Participant";
      refreshPersonDom();
      saveState(state);
      refreshUpdatedLabel();
    });

    timeInput.addEventListener("input", () => {
      if (getSheetConfig()) return;
      person.time = timeInput.value.trim() || "—";
      refreshPersonDom();
      saveState(state);
      refreshUpdatedLabel();
    });

    imageInput.addEventListener("input", () => {
      person.image = imageInput.value.trim();
      refreshPersonDom();
      if (!getSheetConfig()) {
        saveState(state);
        refreshUpdatedLabel();
      }
    });

    imageFileInput.addEventListener("change", () => {
      const f = imageFileInput.files && imageFileInput.files[0];
      imageFileInput.value = "";
      if (!f) return;
      fileToCompressedDataUrl(f, 360, 0.85, 48_000)
        .then((dataUrl) => {
          person.image = dataUrl;
          imageInput.value = dataUrl;
          refreshPersonDom();
          if (!getSheetConfig()) {
            saveState(state);
            refreshUpdatedLabel();
            hideSheetBanner();
            return;
          }
          const msgSuccess =
            `Portrait for “${person.name}” is ready. The image data was copied to your clipboard—paste it into that row’s ` +
            `Image cell in Google Sheets, then click Refresh sheet.`;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(dataUrl).then(
              () => showSheetBanner(msgSuccess, false),
              () =>
                showSheetBanner(
                  `Could not auto-copy. Select the Image URL field above, copy it, paste into the Image cell for “${person.name}”, then Refresh sheet.`,
                  false,
                ),
            );
          } else {
            showSheetBanner(
              `Copy the Image URL field above into the Image cell for “${person.name}” in Google Sheets, then Refresh sheet.`,
              false,
            );
          }
        })
        .catch((err) => {
          showSheetBanner(err.message || String(err), true);
        });
    });

    removeBtn.addEventListener("click", () => {
      if (getSheetConfig()) return;
      state.people = state.people.filter((p) => p.id !== person.id);
      saveState(state);
      renderAll();
    });

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
    const empty = state.people.length === 0;
    els.castEmpty.hidden = !empty;
    if (empty) {
      if (getSheetConfig()) {
        els.castEmpty.textContent =
          "No rows yet. Add data to your sheet (headers: Name, Image, Time), share it publicly, then Refresh sheet.";
      } else {
        els.castEmpty.textContent =
          "No participants yet. Use staff edit to add rows.";
      }
    }

    for (const p of state.people) {
      els.castList.appendChild(renderPerson(p));
    }
    refreshUpdatedLabel();
  }

  els.addPerson.addEventListener("click", () => {
    if (getSheetConfig()) return;
    const person = {
      id: crypto.randomUUID(),
      name: "New participant",
      image: "",
      time: "—",
    };
    state.people.push(person);
    saveState(state);
    renderAll();
  });

  els.btnSyncSheet.addEventListener("click", () => {
    syncFromSheet().finally(() => renderAll());
  });

  els.btnEdit.addEventListener("click", () => {
    if (document.body.classList.contains("edit-mode")) {
      sessionStorage.removeItem(SESSION_EDIT);
      setEditMode(false);
      return;
    }
    if (isEditUnlocked()) {
      setEditMode(true);
      return;
    }
    openPasswordModal();
  });

  els.passwordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = els.passwordInput.value;
    if (val === PASSWORD) {
      sessionStorage.setItem(SESSION_EDIT, "1");
      closePasswordModal();
      setEditMode(true);
    } else {
      els.passwordError.hidden = false;
      els.passwordInput.select();
    }
  });

  els.modalCancel.addEventListener("click", closePasswordModal);

  els.passwordModal.addEventListener("click", (e) => {
    if (e.target === els.passwordModal) closePasswordModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.passwordModal.hidden) closePasswordModal();
  });

  updateShellUi();
  renderAll();

  if (getSheetConfig()) {
    syncFromSheet().finally(() => renderAll());
  } else if (isEditUnlocked()) {
    setEditMode(true);
  }
})();
