/* ============================================================
   Ladenkarte & Einkaufsroute — Phase 1 (lokal, kein Backend)
   Kern-Loop: Karten-Editor · Einkaufszettel · Auto-Sortierung
   + Route-Ansicht mit Karten-Highlight + Erinnerungs-/Aktionsspalte
   State: in-memory, persistiert in localStorage.
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "ladenkarte.v1";

  /* ---------- Hilfen ---------- */
  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9);
  }
  function cellKey(r, c) { return r + "," + c; }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null && attrs[k] !== false) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (ch) {
      if (ch == null || ch === false) return;
      node.appendChild(typeof ch === "string" ? document.createTextNode(ch) : ch);
    });
    return node;
  }

  function readableText(hex) {
    // dunkel/hell-Entscheidung für Text auf farbigem Grund
    var c = hex.replace("#", "");
    if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    var r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
    var lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.62 ? "#1c2430" : "#ffffff";
  }
  function shortLabel(name) {
    var words = name.replace(/[&/]/g, " ").split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  /* ---------- Seed-Daten ---------- */
  function seedDepartments() {
    var base = [
      ["Obst & Gemüse", "#22c55e"],
      ["Backwaren", "#d97706"],
      ["Molkerei/Kühlung", "#3b82f6"],
      ["Fleisch & Wurst", "#ef4444"],
      ["Tiefkühl", "#06b6d4"],
      ["Getränke", "#8b5cf6"],
      ["Konserven/Grundnahrung", "#f59e0b"],
      ["Süßwaren/Snacks", "#ec4899"],
      ["Drogerie/Haushalt", "#14b8a6"],
      ["Kasse", "#6b7280"]
    ];
    return base.map(function (d, i) {
      return { id: uid("dep"), name: d[0], color: d[1], order: i + 1, cells: [] };
    });
  }

  function seedStore() {
    var deps = seedDepartments();
    var byName = {};
    deps.forEach(function (d) { byName[d.name] = d; });

    // Beispielhafte Platzierung auf einem 6x8-Raster (rows x cols)
    var rows = 6, cols = 8;
    function put(name, list) { byName[name].cells = list.map(function (rc) { return cellKey(rc[0], rc[1]); }); }
    put("Obst & Gemüse",          [[0,0],[0,1],[1,0],[1,1]]);
    put("Backwaren",              [[0,2],[0,3]]);
    put("Molkerei/Kühlung",       [[0,6],[0,7],[1,6],[1,7]]);
    put("Fleisch & Wurst",        [[2,6],[2,7]]);
    put("Tiefkühl",               [[3,6],[3,7]]);
    put("Getränke",               [[0,4],[0,5],[1,4],[1,5]]);
    put("Konserven/Grundnahrung", [[3,0],[3,1],[4,0],[4,1]]);
    put("Süßwaren/Snacks",        [[3,3],[3,4]]);
    put("Drogerie/Haushalt",      [[4,6],[4,7]]);
    put("Kasse",                  [[5,3],[5,4]]);

    var products = [
      ["Äpfel", "Obst & Gemüse"], ["Bananen", "Obst & Gemüse"], ["Tomaten", "Obst & Gemüse"],
      ["Brot", "Backwaren"], ["Brötchen", "Backwaren"],
      ["Milch", "Molkerei/Kühlung"], ["Joghurt", "Molkerei/Kühlung"], ["Käse", "Molkerei/Kühlung"], ["Butter", "Molkerei/Kühlung"],
      ["Hähnchenbrust", "Fleisch & Wurst"], ["Aufschnitt", "Fleisch & Wurst"],
      ["Tiefkühlpizza", "Tiefkühl"], ["Eis", "Tiefkühl"],
      ["Wasser", "Getränke"], ["Apfelsaft", "Getränke"], ["Cola", "Getränke"],
      ["Nudeln", "Konserven/Grundnahrung"], ["Reis", "Konserven/Grundnahrung"], ["Tomatensoße", "Konserven/Grundnahrung"],
      ["Schokolade", "Süßwaren/Snacks"], ["Chips", "Süßwaren/Snacks"],
      ["Spülmittel", "Drogerie/Haushalt"], ["Zahnpasta", "Drogerie/Haushalt"], ["Toilettenpapier", "Drogerie/Haushalt"]
    ].map(function (p) {
      return { id: uid("prd"), name: p[0], departmentId: byName[p[1]].id };
    });

    var notices = [
      { id: uid("not"), text: "Tiefkühl wurde umgeräumt – jetzt rechts hinten.", type: "update", createdAt: Date.now() - 86400000 },
      { id: uid("not"), text: "Aktion: Kaffee –20 % diese Woche!", type: "aktion", createdAt: Date.now() - 3600000 }
    ];

    return {
      id: uid("store"),
      name: "Beispiel-Markt",
      grid: { rows: rows, cols: cols },
      departments: deps,
      products: products,
      notices: notices
    };
  }

  /* ---------- State ---------- */
  var state = load() || {
    store: seedStore(),
    list: [],          // [{ productId, checked }]
    ui: { role: "kunde", activeDeptId: null }
  };

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ store: state.store, list: state.list, ui: { role: state.ui.role } })); }
    catch (e) { /* localStorage evtl. nicht verfügbar – App läuft trotzdem */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data.store) return null;
      return { store: data.store, list: data.list || [], ui: { role: (data.ui && data.ui.role) || "kunde", activeDeptId: null } };
    } catch (e) { return null; }
  }

  /* ---------- Abfragen ---------- */
  function depById(id) { return state.store.departments.filter(function (d) { return d.id === id; })[0]; }
  function prodById(id) { return state.store.products.filter(function (p) { return p.id === id; })[0]; }
  function depForCell(key) {
    var deps = state.store.departments;
    for (var i = 0; i < deps.length; i++) if (deps[i].cells.indexOf(key) !== -1) return deps[i];
    return null;
  }
  function sortedDepartments() {
    return state.store.departments.slice().sort(function (a, b) { return a.order - b.order; });
  }

  /* Route: benötigte Abteilungen entlang der Lauf-Reihenfolge, mit ihren Items */
  function buildRoute() {
    var groups = {};
    state.list.forEach(function (item) {
      var p = prodById(item.productId);
      if (!p) return;
      var dep = depById(p.departmentId);
      var key = dep ? dep.id : "__none__";
      (groups[key] = groups[key] || []).push({ item: item, product: p });
    });
    return sortedDepartments()
      .filter(function (d) { return groups[d.id]; })
      .map(function (d) { return { dep: d, entries: groups[d.id] }; });
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-show"); }, 1800);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  var view = document.getElementById("view");

  function render() {
    document.getElementById("storeName").textContent = state.store.name;
    document.getElementById("roleKunde").classList.toggle("is-active", state.ui.role === "kunde");
    document.getElementById("roleHaendler").classList.toggle("is-active", state.ui.role === "haendler");
    document.getElementById("roleKunde").setAttribute("aria-selected", state.ui.role === "kunde");
    document.getElementById("roleHaendler").setAttribute("aria-selected", state.ui.role === "haendler");
    view.innerHTML = "";
    if (state.ui.role === "kunde") renderKunde();
    else renderHaendler();
    save();
  }

  /* ---------- Karten-Komponente ---------- */
  function renderMap(opts) {
    opts = opts || {};
    var grid = state.store.grid;
    var map = el("div", { class: "map" });
    map.style.gridTemplateColumns = "repeat(" + grid.cols + ", 1fr)";
    var maxW = Math.min(grid.cols * 64, 560);
    map.style.maxWidth = maxW + "px";

    for (var r = 0; r < grid.rows; r++) {
      for (var c = 0; c < grid.cols; c++) {
        var key = cellKey(r, c);
        var dep = depForCell(key);
        var cell = el("button", {
          class: "cell" + (dep ? "" : " cell--empty"),
          type: "button",
          "aria-label": dep ? dep.name : "leeres Feld " + (r + 1) + "/" + (c + 1)
        });
        if (dep) {
          cell.style.background = dep.color;
          cell.style.borderColor = dep.color;
          cell.style.color = readableText(dep.color);
          cell.appendChild(el("span", { text: shortLabel(dep.name) }));
        }
        if (opts.highlight && dep && opts.highlight[dep.id]) {
          cell.classList.add("is-highlight");
          cell.appendChild(el("span", { class: "cell__badge", text: String(opts.highlight[dep.id]) }));
        } else if (opts.dimUnhighlighted && opts.highlight) {
          cell.classList.add("is-dim");
        }
        if (opts.onCell) {
          (function (rr, cc) { cell.addEventListener("click", function () { opts.onCell(rr, cc); }); })(r, c);
        } else {
          cell.disabled = true;
          cell.style.cursor = "default";
        }
        map.appendChild(cell);
      }
    }
    return map;
  }

  /* ============================================================
     KUNDE (Shopper) — mobile-first
     ============================================================ */
  function renderKunde() {
    // 1) Einkaufszettel anlegen
    var addCard = el("div", { class: "card" });
    addCard.appendChild(el("h2", { class: "card__title" }, [
      el("span", { class: "section-step", text: "1" }), document.createTextNode(" Einkaufszettel")
    ]));
    addCard.appendChild(el("p", { class: "card__hint", text: "Produkt eintippen und hinzufügen. Vorschläge aus dem Sortiment des Ladens." }));

    var datalist = el("datalist", { id: "prodSuggest" },
      state.store.products.map(function (p) { return el("option", { value: p.name }); }));
    var input = el("input", { class: "input", placeholder: "z. B. Milch", list: "prodSuggest", autocomplete: "off" });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") addToList(input.value); });
    var addBtn = el("button", { class: "btn btn--primary", type: "button", onclick: function () { addToList(input.value); } }, ["Hinzufügen"]);
    var rowAdd = el("div", { class: "row" }, [
      el("div", { style: "flex:3 1 60%" }, [input, datalist]),
      el("div", { style: "flex:1 1 30%" }, [addBtn])
    ]);
    addCard.appendChild(rowAdd);

    // Schnellauswahl-Chips (Sortiment, gruppiert nach Lauf-Reihenfolge)
    var quick = el("div", { class: "palette", style: "margin-top:14px" });
    sortedDepartments().forEach(function (d) {
      state.store.products.filter(function (p) { return p.departmentId === d.id; }).forEach(function (p) {
        var inList = state.list.some(function (it) { return it.productId === p.id; });
        var chip = el("button", {
          class: "chip", type: "button", title: d.name,
          style: "background:" + d.color + ";color:" + readableText(d.color) + (inList ? ";opacity:.45" : ""),
          onclick: function () { addToList(p.name); }
        }, [el("span", { class: "chip__dot" }), document.createTextNode(p.name)]);
        quick.appendChild(chip);
      });
    });
    addCard.appendChild(quick);

    view.appendChild(addCard);

    // 2) + 3) Automatisch sortierte Route
    var route = buildRoute();
    var total = state.list.length;
    var done = state.list.filter(function (i) { return i.checked; }).length;

    var routeCard = el("div", { class: "card" });
    routeCard.appendChild(el("h2", { class: "card__title" }, [
      el("span", { class: "section-step", text: "2" }),
      document.createTextNode(" Deine Route"),
      el("span", { class: "right muted", text: total ? done + " / " + total + " erledigt" : "" })
    ]));
    routeCard.appendChild(el("p", { class: "card__hint", text: "Automatisch nach dem Laufweg des Ladens sortiert." }));

    if (!total) {
      routeCard.appendChild(el("div", { class: "empty" }, [
        el("span", { class: "empty__big", text: "🧺" }),
        document.createTextNode("Noch nichts auf dem Zettel. Füge oben Produkte hinzu.")
      ]));
    } else {
      var visitOrder = {};
      route.forEach(function (g, i) { visitOrder[g.dep.id] = i + 1; });

      route.forEach(function (g) {
        var head = el("div", { class: "route-group__head", style: "background:" + g.dep.color + ";color:" + readableText(g.dep.color) }, [
          el("span", { class: "route-group__num", text: String(visitOrder[g.dep.id]) }),
          document.createTextNode(g.dep.name)
        ]);
        var body = el("div", { class: "route-group__body" });
        g.entries.forEach(function (entry) {
          body.appendChild(listItemRow(entry.item, entry.product));
        });
        routeCard.appendChild(el("div", { class: "route-group" }, [head, body]));
      });

      // ungeordnete Produkte (Abteilung gelöscht) abfangen
      var orphan = state.list.filter(function (it) {
        var p = prodById(it.productId); return !p || !depById(p.departmentId);
      });
      if (orphan.length) {
        var ob = el("div", { class: "route-group__body" });
        orphan.forEach(function (it) { ob.appendChild(listItemRow(it, prodById(it.productId))); });
        routeCard.appendChild(el("div", { class: "route-group" }, [
          el("div", { class: "route-group__head", style: "background:#6b7280" }, [document.createTextNode("Sonstiges")]), ob
        ]));
      }

      routeCard.appendChild(el("div", { class: "spacer" }));
      routeCard.appendChild(el("button", {
        class: "btn btn--ghost btn--sm", type: "button",
        onclick: function () { state.list = []; toast("Zettel geleert"); render(); }
      }, ["Zettel leeren"]));
    }
    view.appendChild(routeCard);

    // Karte mit Highlight
    if (total) {
      var hl = {};
      buildRoute().forEach(function (g, i) { hl[g.dep.id] = i + 1; });
      var mapCard = el("div", { class: "card" });
      mapCard.appendChild(el("h2", { class: "card__title" }, [
        el("span", { class: "section-step", text: "3" }), document.createTextNode(" Karte")
      ]));
      mapCard.appendChild(el("p", { class: "card__hint", text: "Die Nummern zeigen die Reihenfolge der zu besuchenden Abteilungen." }));
      mapCard.appendChild(renderMap({ highlight: hl, dimUnhighlighted: true }));
      view.appendChild(mapCard);
    }

    // Erinnerungen & Aktionen
    if (state.store.notices.length) {
      var nc = el("div", { class: "card" });
      nc.appendChild(el("h2", { class: "card__title", text: "📣 Neues im Laden" }));
      var nlist = el("div", { class: "list" });
      state.store.notices.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (n) {
        nlist.appendChild(el("div", { class: "notice notice--" + n.type }, [
          el("span", { class: "notice__tag", text: n.type === "aktion" ? "Aktion" : "Update" }),
          el("span", { text: n.text })
        ]));
      });
      nc.appendChild(nlist);
      view.appendChild(nc);
    }
  }

  function listItemRow(item, product) {
    var name = product ? product.name : "Unbekannt";
    var check = el("button", {
      class: "check" + (item.checked ? " is-on" : ""), type: "button", "aria-label": "abhaken",
      onclick: function () { item.checked = !item.checked; render(); }
    }, [document.createTextNode("✓")]);
    var label = el("div", { class: "item__name" + (item.checked ? " is-checked" : ""), text: name });
    var del = el("button", {
      class: "btn btn--icon btn--sm btn--ghost", type: "button", "aria-label": "entfernen",
      onclick: function () {
        state.list = state.list.filter(function (i) { return i !== item; });
        render();
      }
    }, ["✕"]);
    return el("div", { class: "item" }, [check, el("div", { class: "item__main" }, [label]), del]);
  }

  function addToList(rawName) {
    var name = (rawName || "").trim();
    if (!name) return;
    // existierendes Produkt (case-insensitive) finden
    var product = state.store.products.filter(function (p) {
      return p.name.toLowerCase() === name.toLowerCase();
    })[0];
    if (!product) {
      // neues Produkt: Abteilung erfragen (einfacher Dialog), Default = erste Abteilung
      product = createProductInteractive(name);
      if (!product) return;
    }
    var existing = state.list.filter(function (i) { return i.productId === product.id; })[0];
    if (existing) { existing.checked = false; toast(product.name + " ist schon auf dem Zettel"); }
    else { state.list.push({ productId: product.id, checked: false }); toast(product.name + " hinzugefügt"); }
    var input = view.querySelector("input.input");
    if (input) { input.value = ""; input.focus(); }
    render();
  }

  function createProductInteractive(name) {
    var deps = sortedDepartments();
    var labels = deps.map(function (d, i) { return (i + 1) + ") " + d.name; }).join("\n");
    var ans = window.prompt(
      '"' + name + '" ist neu. Zu welcher Abteilung gehört es?\nNummer eingeben:\n\n' + labels,
      "1"
    );
    if (ans === null) return null;
    var idx = clamp(parseInt(ans, 10) || 1, 1, deps.length) - 1;
    var product = { id: uid("prd"), name: name, departmentId: deps[idx].id };
    state.store.products.push(product);
    return product;
  }

  /* ============================================================
     HÄNDLER (Editor) — desktop-freundlich
     ============================================================ */
  function ensureActiveDept() {
    if (!state.ui.activeDeptId || !depById(state.ui.activeDeptId)) {
      var first = sortedDepartments()[0];
      state.ui.activeDeptId = first ? first.id : null;
    }
  }

  function renderHaendler() {
    ensureActiveDept();

    // --- Karten-Editor ---
    var editor = el("div", { class: "card" });
    editor.appendChild(el("h2", { class: "card__title" }, [
      el("span", { class: "section-step", text: "1" }), document.createTextNode(" Karten-Editor")
    ]));
    editor.appendChild(el("p", { class: "card__hint", text: "Abteilung wählen, dann Felder antippen, um sie zuzuweisen. Gleiche Abteilung erneut antippen = löschen." }));

    // Palette
    var palette = el("div", { class: "palette" });
    sortedDepartments().forEach(function (d) {
      var active = d.id === state.ui.activeDeptId;
      palette.appendChild(el("button", {
        class: "chip" + (active ? " is-active" : ""), type: "button",
        style: "background:" + d.color + ";color:" + readableText(d.color),
        onclick: function () { state.ui.activeDeptId = d.id; render(); }
      }, [el("span", { class: "chip__dot" }), document.createTextNode(d.name)]));
    });
    palette.appendChild(el("button", {
      class: "chip chip--eraser" + (state.ui.activeDeptId === "__eraser__" ? " is-active" : ""), type: "button",
      onclick: function () { state.ui.activeDeptId = "__eraser__"; render(); }
    }, ["🧽 Radierer"]));
    editor.appendChild(palette);
    editor.appendChild(el("div", { class: "spacer" }));

    // Karte (klickbar)
    editor.appendChild(renderMap({
      onCell: function (r, c) { paintCell(r, c); }
    }));

    // Raster-Größe
    editor.appendChild(el("div", { class: "spacer" }));
    editor.appendChild(gridSizeControls());
    view.appendChild(editor);

    // --- Abteilungen verwalten ---
    var depCard = el("div", { class: "card" });
    depCard.appendChild(el("h2", { class: "card__title", text: "🏷️ Abteilungen & Laufweg" }));
    depCard.appendChild(el("p", { class: "card__hint", text: "Reihenfolge = Laufweg durch den Laden. Pfeile zum Sortieren, Namen/Farbe anpassbar." }));
    var depList = el("ul", { class: "list" });
    sortedDepartments().forEach(function (d, i, arr) {
      depList.appendChild(departmentRow(d, i, arr.length));
    });
    depCard.appendChild(depList);
    depCard.appendChild(el("div", { class: "spacer" }));
    depCard.appendChild(el("button", {
      class: "btn btn--ghost btn--sm", type: "button",
      onclick: function () {
        var name = (window.prompt("Name der neuen Abteilung?") || "").trim();
        if (!name) return;
        var maxOrder = state.store.departments.reduce(function (m, d) { return Math.max(m, d.order); }, 0);
        state.store.departments.push({ id: uid("dep"), name: name, color: "#64748b", order: maxOrder + 1, cells: [] });
        toast("Abteilung hinzugefügt");
        render();
      }
    }, ["+ Abteilung hinzufügen"]));
    view.appendChild(depCard);

    // --- Produkte verwalten ---
    var prodCard = el("div", { class: "card" });
    prodCard.appendChild(el("h2", { class: "card__title", text: "📦 Produkte" }));
    prodCard.appendChild(el("p", { class: "card__hint", text: "Jedes Produkt gehört zu einer Abteilung." }));

    var pName = el("input", { class: "input", placeholder: "Produktname" });
    var pSel = el("select", { class: "input" }, sortedDepartments().map(function (d) {
      return el("option", { value: d.id }, [d.name]);
    }));
    var pAdd = el("button", {
      class: "btn btn--primary", type: "button",
      onclick: function () {
        var name = pName.value.trim();
        if (!name) return;
        state.store.products.push({ id: uid("prd"), name: name, departmentId: pSel.value });
        pName.value = ""; toast("Produkt hinzugefügt"); render();
      }
    }, ["+"]);
    pName.addEventListener("keydown", function (e) { if (e.key === "Enter") pAdd.click(); });
    prodCard.appendChild(el("div", { class: "row" }, [
      el("div", { style: "flex:2 1 45%" }, [pName]),
      el("div", { style: "flex:2 1 35%" }, [pSel]),
      el("div", { style: "flex:0 0 auto" }, [pAdd])
    ]));

    var prodList = el("ul", { class: "list", style: "margin-top:12px" });
    sortedDepartments().forEach(function (d) {
      state.store.products.filter(function (p) { return p.departmentId === d.id; }).forEach(function (p) {
        prodList.appendChild(el("li", { class: "item" }, [
          el("span", { class: "dot", style: "background:" + d.color }),
          el("div", { class: "item__main" }, [
            el("div", { class: "item__name", text: p.name }),
            el("div", { class: "item__sub", text: d.name })
          ]),
          el("button", {
            class: "btn btn--icon btn--sm btn--ghost btn--danger", type: "button", "aria-label": "Produkt löschen",
            onclick: function () {
              state.store.products = state.store.products.filter(function (x) { return x.id !== p.id; });
              state.list = state.list.filter(function (it) { return it.productId !== p.id; });
              render();
            }
          }, ["✕"])
        ]));
      });
    });
    prodCard.appendChild(prodList);
    view.appendChild(prodCard);

    // --- Erinnerungen / Aktionen ---
    var notCard = el("div", { class: "card" });
    notCard.appendChild(el("h2", { class: "card__title", text: "📣 Erinnerungen & Aktionen" }));
    var nText = el("input", { class: "input", placeholder: "z. B. Aktion: Kaffee –20 %" });
    var nType = el("select", { class: "input" }, [
      el("option", { value: "update" }, ["Update"]),
      el("option", { value: "aktion" }, ["Aktion"])
    ]);
    var nAdd = el("button", {
      class: "btn btn--primary", type: "button",
      onclick: function () {
        var text = nText.value.trim();
        if (!text) return;
        state.store.notices.push({ id: uid("not"), text: text, type: nType.value, createdAt: Date.now() });
        nText.value = ""; toast("Hinweis gespeichert"); render();
      }
    }, ["+"]);
    nText.addEventListener("keydown", function (e) { if (e.key === "Enter") nAdd.click(); });
    notCard.appendChild(el("div", { class: "row" }, [
      el("div", { style: "flex:2 1 50%" }, [nText]),
      el("div", { style: "flex:1 1 25%" }, [nType]),
      el("div", { style: "flex:0 0 auto" }, [nAdd])
    ]));
    var nList = el("ul", { class: "list", style: "margin-top:12px" });
    state.store.notices.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (n) {
      nList.appendChild(el("li", { class: "item" }, [
        el("div", { class: "item__main" }, [
          el("div", { class: "notice notice--" + n.type, style: "padding:6px 10px" }, [
            el("span", { class: "notice__tag", text: n.type === "aktion" ? "Aktion" : "Update" }),
            el("span", { text: n.text })
          ])
        ]),
        el("button", {
          class: "btn btn--icon btn--sm btn--ghost btn--danger", type: "button", "aria-label": "Hinweis löschen",
          onclick: function () {
            state.store.notices = state.store.notices.filter(function (x) { return x.id !== n.id; });
            render();
          }
        }, ["✕"])
      ]));
    });
    notCard.appendChild(nList);
    view.appendChild(notCard);

    // --- Zurücksetzen ---
    var reset = el("div", { class: "card" });
    reset.appendChild(el("button", {
      class: "btn btn--ghost btn--sm", type: "button",
      onclick: function () {
        if (!window.confirm("Beispiel-Laden auf Ausgangszustand zurücksetzen? Alle Änderungen gehen verloren.")) return;
        state.store = seedStore(); state.list = []; state.ui.activeDeptId = null;
        toast("Zurückgesetzt"); render();
      }
    }, ["↺ Beispiel-Laden zurücksetzen"]));
    view.appendChild(reset);
  }

  function paintCell(r, c) {
    var key = cellKey(r, c);
    var current = depForCell(key);
    // immer zuerst aus aktueller Abteilung entfernen
    if (current) current.cells = current.cells.filter(function (k) { return k !== key; });
    if (state.ui.activeDeptId === "__eraser__") { render(); return; }
    var active = depById(state.ui.activeDeptId);
    if (!active) { render(); return; }
    // Toggle: war das Feld schon diese Abteilung, bleibt es jetzt leer
    if (!current || current.id !== active.id) active.cells.push(key);
    render();
  }

  function gridSizeControls() {
    function stepper(label, get, setRows) {
      var val = el("span", { class: "counter", text: String(get()) });
      var minus = el("button", { class: "btn btn--icon btn--sm btn--ghost", type: "button", onclick: function () { setRows(-1); } }, ["−"]);
      var plus = el("button", { class: "btn btn--icon btn--sm btn--ghost", type: "button", onclick: function () { setRows(1); } }, ["+"]);
      return el("div", { class: "grid-controls" }, [el("span", { class: "muted", text: label }), minus, val, plus]);
    }
    var wrap = el("div", { class: "row" });
    wrap.appendChild(stepper("Reihen", function () { return state.store.grid.rows; }, function (d) {
      state.store.grid.rows = clamp(state.store.grid.rows + d, 2, 14); pruneCells(); render();
    }));
    wrap.appendChild(stepper("Spalten", function () { return state.store.grid.cols; }, function (d) {
      state.store.grid.cols = clamp(state.store.grid.cols + d, 2, 14); pruneCells(); render();
    }));
    return wrap;
  }

  // Felder außerhalb des (verkleinerten) Rasters entfernen
  function pruneCells() {
    var rows = state.store.grid.rows, cols = state.store.grid.cols;
    state.store.departments.forEach(function (d) {
      d.cells = d.cells.filter(function (k) {
        var parts = k.split(","); return +parts[0] < rows && +parts[1] < cols;
      });
    });
  }

  function departmentRow(d, index, total) {
    var nameInput = el("input", { class: "input", value: d.name, style: "min-height:40px" });
    nameInput.addEventListener("change", function () {
      var v = nameInput.value.trim(); if (v) { d.name = v; render(); }
    });
    var color = el("input", { type: "color", value: d.color, "aria-label": "Farbe", style: "width:42px;height:40px;border:none;background:none;padding:0" });
    color.addEventListener("change", function () { d.color = color.value; render(); });

    var up = el("button", { class: "btn btn--icon btn--sm btn--ghost", type: "button", "aria-label": "nach oben", disabled: index === 0, onclick: function () { moveDept(d, -1); } }, ["↑"]);
    var down = el("button", { class: "btn btn--icon btn--sm btn--ghost", type: "button", "aria-label": "nach unten", disabled: index === total - 1, onclick: function () { moveDept(d, 1); } }, ["↓"]);
    var del = el("button", {
      class: "btn btn--icon btn--sm btn--ghost btn--danger", type: "button", "aria-label": "Abteilung löschen",
      onclick: function () {
        if (state.store.products.some(function (p) { return p.departmentId === d.id; })) {
          if (!window.confirm("Diese Abteilung hat Produkte. Trotzdem löschen? Produkte werden ebenfalls entfernt.")) return;
          var ids = {};
          state.store.products.filter(function (p) { return p.departmentId === d.id; }).forEach(function (p) { ids[p.id] = true; });
          state.store.products = state.store.products.filter(function (p) { return p.departmentId !== d.id; });
          state.list = state.list.filter(function (it) { return !ids[it.productId]; });
        }
        state.store.departments = state.store.departments.filter(function (x) { return x.id !== d.id; });
        if (state.ui.activeDeptId === d.id) state.ui.activeDeptId = null;
        render();
      }
    }, ["✕"]);

    return el("li", { class: "item" }, [
      el("span", { class: "route-group__num", style: "background:" + d.color + ";color:" + readableText(d.color), text: String(index + 1) }),
      color,
      el("div", { class: "item__main" }, [nameInput]),
      up, down, del
    ]);
  }

  function moveDept(d, dir) {
    var sorted = sortedDepartments();
    var i = sorted.indexOf(d);
    var j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    var other = sorted[j];
    var tmp = d.order; d.order = other.order; other.order = tmp;
    render();
  }

  /* ---------- Rollenwechsel ---------- */
  document.getElementById("roleKunde").addEventListener("click", function () { state.ui.role = "kunde"; render(); });
  document.getElementById("roleHaendler").addEventListener("click", function () { state.ui.role = "haendler"; render(); });

  /* ---------- Service Worker (PWA) ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline-Funktion optional */ });
    });
  }

  /* ---------- Start ---------- */
  render();
})();
