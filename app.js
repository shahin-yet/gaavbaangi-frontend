// Wait for the DOM to be fully loaded
window.addEventListener('DOMContentLoaded', function () {
  // Detect if running in Telegram Web App (require real initData)
  const isTelegramWebApp = (() => {
    const wa = window.Telegram && window.Telegram.WebApp;
    if (!wa) return false;
    const initData = typeof wa.initData === 'string' ? wa.initData : '';
    const unsafe = wa.initDataUnsafe || {};
    const hasSignedData = initData.length > 10; // signed payload is always non-trivial
    const hasIdentity = !!(unsafe.user?.id || unsafe.chat?.id || unsafe.query_id);
    return hasSignedData && hasIdentity;
  })();

  // Telegram environment and device detection
  const tgWa = window.Telegram && window.Telegram.WebApp;
  const tgPlatform = tgWa && typeof tgWa.platform === 'string' ? tgWa.platform.toLowerCase() : '';
  const isTelegramMobile = !!tgWa && (tgPlatform === 'android' || tgPlatform === 'ios');
  const isCoarsePointer = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || false;
  const isTouchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isMobileUA = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
  const isMobile = isTelegramMobile || isCoarsePointer || isTouchCapable || isMobileUA;
  
  // Dynamic app height to avoid 100vh issues on mobile browsers
  function updateAppHeight() {
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      const heightFromTelegram = tg && typeof tg.viewportHeight === 'number' ? tg.viewportHeight : null;
      const visualVp = window.visualViewport;
      const vh = heightFromTelegram || (visualVp && typeof visualVp.height === 'number' ? Math.round(visualVp.height) : window.innerHeight);
      document.documentElement.style.setProperty('--app-height', vh + 'px');
    } catch (e) {}
  }
  updateAppHeight();
  window.addEventListener('resize', updateAppHeight);
  window.addEventListener('orientationchange', updateAppHeight);
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
  }
  if (tgWa && typeof tgWa.onEvent === 'function') {
    try { tgWa.onEvent('viewportChanged', updateAppHeight); } catch (e) {}
  }
  
  // Apply environment classes: Telegram presence and device-based mobile UI
  const centerDotEl = document.querySelector('.map-center-dot');
  if (isTelegramWebApp) {
    document.body.classList.add('telegram-webapp');
  } else {
    document.body.classList.remove('telegram-webapp');
  }
  // Mark mobile UI across Telegram and regular browsers
  if (isMobile) {
    document.body.classList.add('mobile-ui');
  } else {
    document.body.classList.remove('mobile-ui');
  }
  // Keep dot element in DOM; CSS controls visibility by class
  if (centerDotEl) {
    centerDotEl.style.display = '';
  }
  
  // Initialize the map
  const map = L.map('map', {
    center: [20.5937, 78.9629], // Centered on India as an example
    zoom: 5,
    zoomControl: true
  });

  // Terrain layer (OpenTopoMap)
  const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors'
  });

  // Satellite layer (Esri World Imagery)
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  // Add satellite layer by default
  satellite.addTo(map);

  // -----------------------------
  // Refuge rendering layer group
  // -----------------------------
  const refugeLayerGroup = L.layerGroup().addTo(map);
  let lastDeletedRefuge = null; // for Undo restore

  function escapeHtml(str) {
    try {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    } catch (e) { return ''; }
  }

  async function updateRefugeName(refugeId, newName) {
    const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges/${refugeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'success') {
      const msg = (data && data.message) || `Failed to update (${res.status})`;
      throw new Error(msg);
    }
    return data.refuge;
  }

  async function deleteRefugeById(refugeId) {
    const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges/${refugeId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'success') {
      const msg = (data && data.message) || `Failed to delete (${res.status})`;
      throw new Error(msg);
    }
    return data.deleted;
  }

  async function recreateRefuge(refuge) {
    const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: refuge.name, polygon: refuge.polygon })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'success') {
      const msg = (data && data.message) || `Failed to restore (${res.status})`;
      throw new Error(msg);
    }
    return data.refuge;
  }

  function showUndoToast(message, onUndo, timeoutMs = 12000) {
    try { document.querySelectorAll('.undo-toast').forEach(el => el.remove()); } catch (e) {}
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.innerHTML = `<span class="undo-msg">${escapeHtml(message)}</span><button class="undo-btn" type="button">Undo</button>`;
    document.body.appendChild(toast);
    let cleared = false;
    const clear = () => { if (cleared) return; cleared = true; try { toast.remove(); } catch (e) {} };
    const timer = setTimeout(clear, timeoutMs);
    const btn = toast.querySelector('.undo-btn');
    if (btn) btn.addEventListener('click', async () => {
      try { clearTimeout(timer); } catch (e) {}
      clear();
      try { await onUndo(); } catch (e) {}
    });
  }

  function openRefugeEditor(refuge) {
    // Reuse drawing HUD for a consistent look
    const beginEditing = () => {
      try { document.body.classList.add('editing-active'); } catch (e) {}
      // Mark editing state to selectively disable other UI while allowing Layer/Center
      window.__editing = true;
    };
    const endEditing = () => {
      try { document.body.classList.remove('editing-active'); } catch (e) {}
      window.__editing = false;
      try {
        if (window.__editBlocker && window.__editBlocker.parentNode) {
          window.__editBlocker.parentNode.removeChild(window.__editBlocker);
        }
        window.__editBlocker = null;
      } catch (e) {}
    };
    // Close any open UI panels and popups while entering edit mode
    try { document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show')); } catch (e) {}
    try { typeof closeSidePanel === 'function' && closeSidePanel(); } catch (e) {}
    try { map && map.closePopup && map.closePopup(); } catch (e) {}
    beginEditing();
    const hudApi = createDrawingHud(() => {
      const hud = document.querySelector('.drawing-hud');
      hud && hud.remove();
      endEditing();
    });
    const hud = document.querySelector('.drawing-hud');
    if (!hud) return;
    const titleEl = hud.querySelector('.hud-title span');
    if (titleEl) titleEl.textContent = 'Edit bar';
    // Remove the drawing announcement in edit mode (hide status area by default)
    const statusEl = hud.querySelector('.hud-status');
    if (statusEl) { statusEl.innerHTML = ''; statusEl.style.display = 'none'; }
    // Remove name input and Save button entirely in edit mode; keep actions area visible
    const controls = hud.querySelector('.hud-controls');
    const inputEl = hud.querySelector('.hud-name');
    if (inputEl) { try { inputEl.remove(); } catch (e) {} }
    const okBtn = hud.querySelector('.hud-ok');
    if (okBtn) { try { okBtn.remove(); } catch (e) {} }
    if (controls) { controls.style.display = ''; }
    const actions = hud.querySelector('.hud-actions');
    if (actions && !hud.querySelector('.hud-delete')) {
      const del = document.createElement('button');
      del.className = 'hud-delete';
      del.type = 'button';
      del.textContent = 'Delete';
      actions.appendChild(del);
      del.addEventListener('click', async () => {
        // Hide the delete button while processing to prevent repeat clicks
        try { del.disabled = true; del.style.display = 'none'; } catch (e) {}
        try {
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus('Deleting…', 'info');
          const deleted = await deleteRefugeById(refuge.id);
          lastDeletedRefuge = deleted;
          await loadAndRenderRefuges();
          const h = document.querySelector('.drawing-hud');
          h && h.remove();
          endEditing();
          showUndoToast('Refuge deleted', async () => {
            if (lastDeletedRefuge) {
              try { await recreateRefuge(lastDeletedRefuge); } finally { lastDeletedRefuge = null; }
              await loadAndRenderRefuges();
            }
          }, 12000);
        } catch (e) {
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus((e && e.message) || 'Delete failed', 'error');
          // Restore the button if deletion fails
          try { del.disabled = false; del.style.display = ''; } catch (err) {}
        }
      });
    }
    // No rename in edit mode; only Delete is available
  }

  async function loadAndRenderRefuges() {
    try {
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges`);
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.refuges)) {
        refugeLayerGroup.clearLayers();
        data.refuges.forEach(r => {
          try {
            if (r && r.polygon && (r.polygon.type === 'Polygon' || r.polygon.type === 'MultiPolygon')) {
              const geom = r.polygon;
              const drawPolygon = (polyCoords) => {
                const latlngs = (polyCoords || []).map(ring => ring.map(([lng, lat]) => [lat, lng]));
                if (!latlngs.length) return;
                const polygon = L.polygon(latlngs, {
                  color: '#1e90ff',
                  weight: 2,
                  fillColor: '#1e90ff',
                  fillOpacity: 0.15
                });
                polygon._refuge = { id: r.id, name: r.name, polygon: r.polygon };
                const popupId = `ref-edit-${r.id}`;
                const renameId = `ref-rename-${r.id}`;
                const nameInputId = `ref-name-input-${r.id}`;
                const popupHtml = `
                  <div class="refuge-popup">
                    <div class="refuge-name-row">
                      <div class="refuge-name">${escapeHtml(r.name || 'Refuge')}</div>
                      <button id="${renameId}" class="refuge-rename-btn" type="button">rename</button>
                    </div>
                    <button id="${popupId}" class="refuge-edit-link" type="button">Edit</button>
                  </div>
                `;
                polygon.addTo(refugeLayerGroup).bindPopup(popupHtml);
                polygon.on('popupopen', () => {
                  const editBtn = document.getElementById(popupId);
                  if (editBtn) {
                    editBtn.onclick = (ev) => {
                      ev && ev.stopPropagation && ev.stopPropagation();
                      try { polygon.closePopup(); } catch (e) {}
                      openRefugeEditor(polygon._refuge);
                    };
                  }
                  const renameBtn = document.getElementById(renameId);
                  const popupRoot = renameBtn ? renameBtn.closest('.refuge-popup') : null;
                  const nameEl = popupRoot ? popupRoot.querySelector('.refuge-name') : null;
                  let renaming = false;
                  const enterHandler = async (e) => {
                    if (e && (e.key === 'Enter' || e.keyCode === 13)) {
                      e.preventDefault();
                      await doSave();
                    } else if (e && (e.key === 'Escape' || e.keyCode === 27)) {
                      // cancel rename: restore label
                      exitRename(false);
                    }
                  };
                  const exitRename = (updated, newName) => {
                    if (!popupRoot) return;
                    const input = popupRoot.querySelector(`#${nameInputId}`);
                    if (input && input.removeEventListener) input.removeEventListener('keydown', enterHandler);
                    if (nameEl) {
                      if (updated && typeof newName === 'string') {
                        nameEl.textContent = newName;
                      }
                      nameEl.style.display = '';
                    }
                    const existingInput = popupRoot.querySelector(`#${nameInputId}`);
                    if (existingInput && existingInput.parentNode) {
                      existingInput.parentNode.removeChild(existingInput);
                    }
                    if (renameBtn) {
                      renameBtn.disabled = false;
                      renameBtn.textContent = 'rename';
                    }
                    renaming = false;
                  };
                  const doSave = async () => {
                    if (!popupRoot) return;
                    const input = popupRoot.querySelector(`#${nameInputId}`);
                    const val = input && typeof input.value === 'string' ? input.value.trim() : '';
                    if (!val) { exitRename(false); return; }
                    try {
                      if (renameBtn) renameBtn.disabled = true;
                      const updated = await updateRefugeName(polygon._refuge.id, val);
                      polygon._refuge.name = updated && updated.name ? updated.name : val;
                      exitRename(true, polygon._refuge.name);
                    } catch (err) {
                      alert((err && err.message) || 'Failed to rename');
                      if (renameBtn) renameBtn.disabled = false;
                    }
                  };
                  if (renameBtn && nameEl) {
                    renameBtn.onclick = async (e) => {
                      e && e.stopPropagation && e.stopPropagation();
                      if (!renaming) {
                        // enter rename mode
                        renaming = true;
                        // hide label, insert input
                        nameEl.style.display = 'none';
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.id = nameInputId;
                        input.className = 'refuge-name-input';
                        input.value = nameEl.textContent || '';
                        nameEl.parentNode && nameEl.parentNode.insertBefore(input, renameBtn);
                        try { input.focus(); input.select && input.select(); } catch (e) {}
                        input.addEventListener('keydown', enterHandler);
                        renameBtn.textContent = 'Save';
                      } else {
                        await doSave();
                      }
                    };
                  }
                });
              };
              if (geom.type === 'Polygon') {
                drawPolygon(geom.coordinates || []);
              } else {
                // MultiPolygon: iterate each polygon's rings
                (geom.coordinates || []).forEach(poly => drawPolygon(poly));
              }
            }
          } catch (e) {
            console.warn('Failed to render refuge', e);
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load refuges', e);
    }
  }
  // initial fetch
  loadAndRenderRefuges();

  // Mobile: center-dot selector model (select by moving map under the dot)
  if (isMobile) {
    let selectedLatLng = map.getCenter();
    const updateSelected = () => {
      selectedLatLng = map.getCenter();
    };
    map.on('move', updateSelected);
    map.on('zoomend', updateSelected);
    updateSelected();

    // Expose selection accessors
    window.MapSelection = {
      getLatLng: function () {
        return { lat: selectedLatLng.lat, lng: selectedLatLng.lng };
      },
      getPixel: function () {
        return map.latLngToContainerPoint(selectedLatLng);
      },
      getLatLngRounded: function (precision = 6) {
        return {
          lat: Number(selectedLatLng.lat.toFixed(precision)),
          lng: Number(selectedLatLng.lng.toFixed(precision))
        };
      }
    };

    // Apply double-tap/double-click actions at center (selector dot) instead of touch point
    map.doubleClickZoom && map.doubleClickZoom.disable();

    const applyCenterDoubleAction = () => {
      const center = map.getCenter();
      const pixel = map.latLngToContainerPoint(center);
      // If not suppressed, perform default zoom. Always dispatch event.
      if (!window.__suppressCenterDoubleAction) {
        map.zoomIn(1);
      }
      // Dispatch a custom event in case the host app wants to consume it
      window.dispatchEvent(new CustomEvent('map-center-doubletap', {
        detail: { latlng: { lat: center.lat, lng: center.lng }, pixel }
      }));
    };

    // Desktop-style double click (if a dblclick occurs on mobile web/Telegram)
    map.on('dblclick', function (ev) {
      if (ev && ev.originalEvent) {
        ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
        ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
      }
      applyCenterDoubleAction();
    });

    // Mobile double-tap detection
    let lastTapTime = 0;
    map.getContainer().addEventListener('touchend', function (ev) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        ev.preventDefault();
        ev.stopPropagation();
        // Route double-tap through center-double action; drawing mode will handle closure
        applyCenterDoubleAction();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        setTimeout(() => { if (Date.now() - lastTapTime >= 300) lastTapTime = 0; }, 350);
      }
    }, { passive: false });
  }

  // Layer control removed - using custom toolbar instead

  // Create option panels for toolbar buttons
  function createOptionPanel(buttonId, options) {
    const button = document.getElementById(buttonId);
    const panel = document.createElement('div');
    panel.className = 'option-panel';
    // Helper: close any open Leaflet popups (name flags)
    const closeMapPopup = () => { try { map && map.closePopup && map.closePopup(); } catch (e) {} };
    
    options.forEach(option => {
      const item = document.createElement('div');
      item.className = 'option-item';
      item.innerHTML = `<i class="${option.icon}"></i>${option.text}`;
      // Always close any open option panels after a selection, then run the action
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        // Block option logic while drawing is active, except for layer panel actions
        if ((buttonId !== 'btn-layer') && (((typeof drawing !== 'undefined') && drawing) || (window.__editing))) {
          return;
        }
        // Close any open name popups
        closeMapPopup();
        try {
          document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
        } catch (err) {}
        try {
          if (typeof option.action === 'function') option.action();
        } catch (err) { console.warn(err); }
      });
      panel.appendChild(item);
    });
    
    button.appendChild(panel);
    
    // Toggle panel on button click
    button.onclick = function(e) {
      e.stopPropagation();
      // Block opening option panels while drawing, except allow the layer panel
      if ((buttonId !== 'btn-layer') && (((typeof drawing !== 'undefined') && drawing) || (window.__editing))) {
        return;
      }
      // Close any open name popups when interacting with toolbar
      closeMapPopup();
      const isVisible = panel.classList.contains('show');
      
      // Close all other panels first
      document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
      
      // Toggle current panel
      if (!isVisible) {
        panel.classList.add('show');
      }
    };
  }

  // Close panels when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.map-toolbar')) {
      document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
    }
  });

  // Initialize toolbar with option panels
  let currentLayer = 'satellite';
  
  // Layer button options
  createOptionPanel('btn-layer', [
    {
      icon: 'fas fa-satellite',
      text: 'Satellite',
      action: function() {
        map.removeLayer(terrain);
        satellite.addTo(map);
        currentLayer = 'satellite';
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
      }
    },
    {
      icon: 'fas fa-mountain',
      text: 'Terrain',
      action: function() {
        map.removeLayer(satellite);
        terrain.addTo(map);
        currentLayer = 'terrain';
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
      }
    }
  ]);

  // Drawing button options
  createOptionPanel('btn-drawing', [
    {
      icon: 'fas fa-route',
      text: 'Path',
      action: function() {
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
        alert('Path drawing: coming soon.');
      }
    },
    {
      icon: 'fas fa-shield-alt',
      text: 'Refuge',
      action: function() {
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
        startRefugeDrawing();
      }
    }
  ]);

  // Center button (no options, just action)
  document.getElementById('btn-center').onclick = function() {
    try { map && map.closePopup && map.closePopup(); } catch (e) {}
    map.setView([20.5937, 78.9629], 5);
  };

  // Floating menu and side panel logic
  const fabMenu = document.getElementById('fab-menu');
  const sidePanel = document.getElementById('side-panel');
  const sideClose = document.getElementById('side-close');
  const menuOverlay = document.getElementById('menu-overlay');

  function openSidePanel() {
    sidePanel.classList.add('show');
    menuOverlay.classList.add('show');
    sidePanel.setAttribute('aria-hidden', 'false');
    menuOverlay.setAttribute('aria-hidden', 'false');
    // Mark body so CSS can hide FAB to prevent overlap
    document.body.classList.add('side-open');
  }

  function closeSidePanel() {
    sidePanel.classList.remove('show');
    menuOverlay.classList.remove('show');
    sidePanel.setAttribute('aria-hidden', 'true');
    menuOverlay.setAttribute('aria-hidden', 'true');
    // Remove marker class when panel closes
    document.body.classList.remove('side-open');
  }

  if (fabMenu && sidePanel && sideClose && menuOverlay) {
    fabMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      try { map && map.closePopup && map.closePopup(); } catch (err) {}
      openSidePanel();
    });
    sideClose.addEventListener('click', function (e) {
      e.stopPropagation();
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      closeSidePanel();
    });
    menuOverlay.addEventListener('click', function () {
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      closeSidePanel();
    });
  }

  // Menu item actions
  const menuActions = {
    'about': () => {
      alert('About: Coming soon.');
      closeSidePanel();
    },
    'data': () => {
      alert('Data: Coming soon.');
      closeSidePanel();
    },
    'admin-map': () => {
      // Already on this page; keep active state
      document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
      const item = document.querySelector('.menu-item[data-action="admin-map"]');
      if (item) item.classList.add('active');
      closeSidePanel();
    },
    'user-map': () => {
      alert('User Map: Coming soon.');
      closeSidePanel();
    }
  };

  document.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', function () {
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      try { map && map.closePopup && map.closePopup(); } catch (err) {}
      const action = this.getAttribute('data-action');
      const handler = menuActions[action];
      if (typeof handler === 'function') handler();
    });
  });
  // -----------------------------
  // Refuge drawing logic
  // -----------------------------
  let drawing = null; // state holder when active

  function createDrawingHud(onCancel) {
    let hud = document.querySelector('.drawing-hud');
    if (hud) hud.remove();
    hud = document.createElement('div');
    hud.className = 'drawing-hud';
    const initialMsg = 'click to add vertex';
    hud.innerHTML = `
      <div class="hud-row">
        <div class="hud-title">
          <span>Drawing refuge</span>
        </div>
        <button class="hud-cancel" title="Cancel" aria-label="Cancel drawing">✕</button>
      </div>
      <div class="hud-status status-info">${initialMsg}</div>
      <div class="hud-controls" style="display:none;">
        <input class="hud-name" type="text" placeholder="Refuge name" aria-label="Refuge name" />
        <div class="hud-actions">
          <button class="hud-ok" type="button" aria-label="Confirm name">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(hud);
    hud.querySelector('.hud-cancel').addEventListener('click', () => { onCancel && onCancel(); });
    const statusEl = hud.querySelector('.hud-status');
    const controlsEl = hud.querySelector('.hud-controls');
    const setStatus = (text, kind = 'info') => {
      if (!statusEl) return;
      const safe = (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      statusEl.innerHTML = safe;
      statusEl.classList.remove('status-info', 'status-error', 'status-success');
      statusEl.classList.add(`status-${kind}`);
    };
    const nameInput = hud.querySelector('.hud-name');
    const okButton = hud.querySelector('.hud-ok');
    const getName = () => (nameInput && typeof nameInput.value === 'string' ? nameInput.value.trim() : '');
    const focusName = () => { try { nameInput && nameInput.focus(); nameInput && nameInput.select && nameInput.select(); } catch (e) {} };
    const showNameBar = () => { if (controlsEl) controlsEl.style.display = ''; };
    const hideNameBar = () => { if (controlsEl) controlsEl.style.display = 'none'; };
    const hideOk = () => { try { okButton && (okButton.style.display = 'none'); } catch (e) {} };
    const showOk = () => { try { okButton && (okButton.style.display = ''); } catch (e) {} };
    const onNameEnter = (cb) => {
      if (!nameInput) return;
      const handler = (e) => {
        if (e && (e.key === 'Enter' || e.keyCode === 13)) {
          e.preventDefault();
          cb && cb();
        }
      };
      nameInput.addEventListener('keydown', handler);
    };
    const onOkClick = (cb) => { if (okButton) okButton.addEventListener('click', () => cb && cb()); };
    return { hud, setStatus, getName, focusName, onNameEnter, onOkClick, showNameBar, hideNameBar, hideOk, showOk };
  }

  function teardownDrawing() {
    if (!drawing) return;
    map.getContainer().style.cursor = '';
    // Clear any idle timers used for dynamic announcements
    if (drawing.idleTimer) {
      try { clearTimeout(drawing.idleTimer); } catch (e) {}
    }
    // Restore double-click zoom on web if it was previously enabled
    if (drawing.mode === 'web' && map.doubleClickZoom && drawing.prevDoubleClickZoomEnabled) {
      try { map.doubleClickZoom.enable(); } catch (e) {}
    }
    // Stop suppressing center double action on Telegram
    if (drawing.mode === 'telegram') {
      window.__suppressCenterDoubleAction = false;
    }
    if (drawing.mouseHandlers) {
      drawing.mouseHandlers.forEach(({ evt, fn }) => map.off(evt, fn));
    }
    if (drawing.domHandlers) {
      drawing.domHandlers.forEach(({ el, evt, fn, opts }) => el.removeEventListener(evt, fn, opts || false));
    }
    // No deferred timers to clear anymore
    if (drawing.polyline) refugeLayerGroup.removeLayer(drawing.polyline);
    if (drawing.firstMarker) refugeLayerGroup.removeLayer(drawing.firstMarker);
    if (drawing.tempGuide) refugeLayerGroup.removeLayer(drawing.tempGuide);
    const hud = document.querySelector('.drawing-hud');
    if (hud) hud.remove();
    const dot = document.querySelector('.map-center-dot');
    if (dot) dot.classList.remove('near-first');
    // Re-enable bottom UI interactions
    try { document.body.classList.remove('drawing-active'); } catch (e) {}
    drawing = null;
  }

  function setDrawingCursor(cursorType) {
    if (!drawing) return;
    const container = map.getContainer();
    switch (cursorType) {
      case 'cross':
        container.style.cursor = 'crosshair';
        break;
      case 'grab':
        container.style.cursor = 'grab';
        break;
      case 'grabbing':
        container.style.cursor = 'grabbing';
        break;
      case 'default':
      default:
        container.style.cursor = '';
        break;
    }
  }

  async function saveRefugePolygon(latlngs, name, setStatus) {
    // Ensure closed ring and convert to GeoJSON lon/lat
    const ring = latlngs.map(ll => [ll.lng, ll.lat]);
    // Block saving with fewer than 3 vertices (no area with two angles)
    if (ring.length < 3) {
      setStatus && setStatus('Need at least 3 points', 'error');
      return false;
    }
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    }
    if (!name || !name.trim()) {
      setStatus && setStatus('Enter a name in the bar to save.', 'info');
      return false;
    }
    try {
      setStatus && setStatus('Saving…', 'info');
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, polygon: { type: 'Polygon', coordinates: [ring] } })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.status === 'success') {
        await loadAndRenderRefuges();
        setStatus && setStatus('Saved.', 'success');
        return true;
      }
      const serverMsg = (data && data.message) || '';
      const isDuplicate = res.status === 409 || /already exists/i.test(serverMsg);
      if (isDuplicate) {
        setStatus && setStatus('That name is already in use. Enter a different name in the bar.', 'error');
        return false;
      }
      const msg = serverMsg || `Failed to save refuge (${res.status})`;
      setStatus && setStatus(msg, 'error');
      return false;
    } catch (e) {
      setStatus && setStatus('Error saving refuge.', 'error');
      return false;
    }
  }

  function startRefugeDrawing() {
    if (drawing) teardownDrawing();
    // Disable bottom UI interactions while drawing
    try {
      document.body.classList.add('drawing-active');
      // Close any open option panels and side panel to avoid overlaying the map
      try { document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show')); } catch (e) {}
      try { typeof closeSidePanel === 'function' && closeSidePanel(); } catch (e) {}
    } catch (e) {}
    const hudApi = createDrawingHud(() => teardownDrawing());

    const state = {
      // Use mobile-vs-desktop to decide interaction model, independent of Telegram
      mode: isMobile ? 'telegram' : 'web',
      vertices: [], // array of L.LatLng
      polyline: L.polyline([], { color: '#ff5722', weight: 2 }).addTo(refugeLayerGroup),
      firstMarker: null,
      tempGuide: null,
      closedPreview: null,
      mouseHandlers: [],
      domHandlers: [],
      prevDoubleClickZoomEnabled: false,
      lastTouchTime: 0,
      suppressNextDblClick: false,
      isClosing: false,
      helpersMuted: false, // when true, helper announcements are suppressed
      isDragging: false,
      setStatus: hudApi.setStatus,
      getName: hudApi.getName,
      focusName: hudApi.focusName,
      showNameBar: hudApi.showNameBar,
      hideNameBar: hudApi.hideNameBar
    };
    drawing = state;
    // Dynamic announcement helpers (always use desktop text on all devices)
    const getMsgClickToAdd = () => 'click to add vertex';
    const getMsgDragToDraw = () => 'drag to draw line';
    const getMsgDoubleToClose = () => 'double click to close area';
    const showClickToAdd = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgClickToAdd(), 'info'); };
    const showDragToDraw = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgDragToDraw(), 'info'); };
    const showDoubleToClose = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgDoubleToClose(), 'info'); };
    // Show initial message on start
    showClickToAdd();
    const attemptSave = async () => {
      // From the moment we ask for a name or attempt to save, freeze helper texts
      state.helpersMuted = true;
      if (state.idleTimer) { try { clearTimeout(state.idleTimer); } catch (e) {} }
      if (state.vertices.length < 3) {
        state.setStatus && state.setStatus('Need at least 3 points', 'error');
        return;
      }
      // Detach the drawing line immediately upon closing intent
      if (!state.closedPreview) {
        showClosedPreview();
      }
      const name = state.getName ? state.getName() : '';
      if (!name) {
        state.showNameBar && state.showNameBar();
        state.setStatus && state.setStatus('Enter a name to save.', 'info');
        state.focusName && state.focusName();
        return;
      }
      hudApi.hideOk && hudApi.hideOk();
      const ok = await saveRefugePolygon(state.vertices, name, state.setStatus);
      if (ok) {
        teardownDrawing();
      } else {
        hudApi.showOk && hudApi.showOk();
      }
    };

    hudApi.onNameEnter && hudApi.onNameEnter(() => {
      if (state.vertices.length >= 3) {
        attemptSave();
      }
    });
    hudApi.onOkClick && hudApi.onOkClick(() => {
      if (state.vertices.length >= 3) {
        attemptSave();
      }
    });


    const NEAR_FIRST_THRESHOLD_PX_TG = 8; // tighter proximity: require near-exact overlap on Telegram
    const NEAR_FIRST_THRESHOLD_PX = 8; // tighter proximity: require near-exact overlap on web

    const updatePolyline = () => {
      state.polyline.setLatLngs(state.vertices);
      if (state.vertices.length > 0) {
        if (!state.tempGuide) {
          state.tempGuide = L.polyline([], { color: '#ff5722', dashArray: '4,6', weight: 2 }).addTo(refugeLayerGroup);
        }
      }
    };

    const showClosedPreview = () => {
      if (state.closedPreview || state.vertices.length < 3) return;
      try {
        // Remove drawing aids
        if (state.tempGuide) { refugeLayerGroup.removeLayer(state.tempGuide); state.tempGuide = null; }
        if (state.polyline) { refugeLayerGroup.removeLayer(state.polyline); }
        if (state.firstMarker) { refugeLayerGroup.removeLayer(state.firstMarker); state.firstMarker = null; }
        // Create a filled polygon preview from current vertices
        state.closedPreview = L.polygon(state.vertices, {
          color: '#1e90ff',
          weight: 2,
          fillColor: '#1e90ff',
          fillOpacity: 0.15
        }).addTo(refugeLayerGroup);
        setDrawingCursor('default');
      } catch (e) {
        // keep fallback to line if preview fails
      }
    };

    const setFirstMarker = (latlng) => {
      if (state.firstMarker) return;
      state.firstMarker = L.circleMarker(latlng, { radius: 5, color: '#1e90ff', fillColor: '#1e90ff', fillOpacity: 0.9 }).addTo(refugeLayerGroup);
      // Enable closing by interacting directly with the first vertex marker
      if (state.mode === 'web') {
        const finishIfReady = async () => {
          if (state.vertices.length >= 3) {
            await attemptSave();
          } else {
            state.setStatus && state.setStatus('Need at least 3 points', 'error');
          }
        };
        state.firstMarker.on('dblclick', (ev) => {
          if (ev && ev.originalEvent) {
            ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
            ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
          }
          finishIfReady();
        });
        // Touch double-tap on marker for mobile web
        let markerLastTouchTime = 0;
        // No extra messaging on marker hover/touchstart
        state.firstMarker.on('touchend', async (ev) => {
          const now = Date.now();
          if (ev && ev.originalEvent) {
            ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
            ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
          }
          if (now - markerLastTouchTime < 280) {
            markerLastTouchTime = 0;
            await finishIfReady();
          } else {
            markerLastTouchTime = now;
          }
        });
        // No extra messaging on marker hover
      } else {
        // Telegram mobile: allow double-tap directly on the marker to finish (ignore center proximity)
        const finishIfReadyTg = async () => {
          if (state.vertices.length >= 3) {
            await attemptSave();
          } else {
            state.setStatus && state.setStatus('Need at least 3 points', 'error');
          }
        };
        let markerLastTouchTimeTg = 0;
        // No extra messaging on marker touchstart (telegram)
        state.firstMarker.on('touchend', async (ev) => {
          const now = Date.now();
          if (ev && ev.originalEvent) {
            ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
            ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
          }
          if (now - markerLastTouchTimeTg < 280) {
            markerLastTouchTimeTg = 0;
            await finishIfReadyTg();
          } else {
            markerLastTouchTimeTg = now;
          }
        });
      }
    };

    if (state.mode === 'telegram') {
      // Telegram: tapping anywhere adds center point; double tap closes
      // Use circular on-screen selector (hide OS cursor)
      setDrawingCursor('default');
      const container = map.getContainer();
      container.style.cursor = 'none';
      state.touchStart = { x: 0, y: 0, t: 0 };
      state.touchMoved = false;
      const TAP_MOVE_THRESHOLD_PX = 8;

      const getTouchPoint = (e) => {
        const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || null;
        return t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
      };

      const onTouchStart = (ev) => {
        const p = getTouchPoint(ev);
        if (!p) return;
        state.touchStart = p;
        state.touchMoved = false;
      };

      const onTouchMove = (ev) => {
        const p = getTouchPoint(ev);
        if (!p) return;
        const dx = p.x - state.touchStart.x;
        const dy = p.y - state.touchStart.y;
        if ((dx * dx + dy * dy) > (TAP_MOVE_THRESHOLD_PX * TAP_MOVE_THRESHOLD_PX)) {
          state.touchMoved = true; // treat as pan/drag
        }
      };

      const onTouchEnd = (ev) => {
        const now = Date.now();
        // If finger moved significantly, ignore as tap
        if (state.touchMoved) return;
        // Double-tap is handled globally; skip adding
        if (now - state.lastTouchTime < 280) { state.lastTouchTime = 0; return; }
        state.lastTouchTime = now;
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
        // If preview is shown, do not add more vertices (detached)
        if (state.closedPreview) return;
        // Immediate add (no defer)
        const centerLatLng = map.getCenter();
        state.vertices.push(centerLatLng);
        setFirstMarker(state.vertices[0]);
        updatePolyline();
        // After first vertex, mirror desktop guidance
        if (state.vertices.length >= 1) { showDragToDraw(); } else { showClickToAdd(); }
        state.lastVertexAddedAt = Date.now();
        state.lastVertexAddedBy = 'tap';
      };
      const onMove = () => {
        if (state.tempGuide && state.vertices.length > 0) {
          state.tempGuide.setLatLngs([state.vertices[state.vertices.length - 1], map.getCenter()]);
        }
        // Maintain the near-first visual indicator
        const dot = document.querySelector('.map-center-dot');
        let nearFirst = false;
        if (dot && state.vertices.length >= 3) {
          const first = state.vertices[0];
          const center = map.getCenter();
          const pFirst = map.latLngToContainerPoint(first);
          const pCenter = map.latLngToContainerPoint(center);
          const dx = pCenter.x - pFirst.x;
          const dy = pCenter.y - pFirst.y;
          if ((dx * dx + dy * dy) <= (NEAR_FIRST_THRESHOLD_PX_TG * NEAR_FIRST_THRESHOLD_PX_TG)) {
            dot.classList.add('near-first');
            nearFirst = true;
          } else {
            dot.classList.remove('near-first');
          }
        } else if (dot) {
          dot.classList.remove('near-first');
        }
        // Messaging based on drag state
        if (state.vertices.length === 0) {
          showClickToAdd();
          return;
        }
        if (state.isDragging) {
          showClickToAdd();
          return;
        }
        if (state.vertices.length >= 3 && nearFirst) {
          showDoubleToClose();
        } else {
          showDragToDraw();
        }
      };
      const onDragStart = () => {
        state.isDragging = true;
        if (state.vertices.length >= 1 && !state.closedPreview) {
          showClickToAdd();
        }
      };
      const onDragEnd = () => {
        state.isDragging = false;
        if (state.closedPreview) return;
        if (state.vertices.length === 0) {
          showClickToAdd();
        } else {
          const first = state.vertices[0];
          const center = map.getCenter();
          const pFirst = map.latLngToContainerPoint(first);
          const pCenter = map.latLngToContainerPoint(center);
          const dx = pCenter.x - pFirst.x;
          const dy = pCenter.y - pFirst.y;
          const nearFirst = (dx * dx + dy * dy) <= (NEAR_FIRST_THRESHOLD_PX_TG * NEAR_FIRST_THRESHOLD_PX_TG);
          if (state.vertices.length >= 3 && nearFirst) {
            showDoubleToClose();
          } else {
            showDragToDraw();
          }
        }
      };
      const onCenterDouble = async () => {
        if (state.vertices.length >= 3) {
          const center = map.getCenter();
          const first = state.vertices[0];
          const pFirst = map.latLngToContainerPoint(first);
          const pCenter = map.latLngToContainerPoint(center);
          const dx = pCenter.x - pFirst.x;
          const dy = pCenter.y - pFirst.y;
          if ((dx * dx + dy * dy) <= (NEAR_FIRST_THRESHOLD_PX_TG * NEAR_FIRST_THRESHOLD_PX_TG)) {
            // No deferred tap to cancel
            // Keep circular selector (no OS cursor)
            setDrawingCursor('default');
            container.style.cursor = 'none';
            // close polygon
            // If a vertex was just added moments ago as part of a double-tap sequence, remove it
            if (state.lastVertexAddedBy === 'tap' && (Date.now() - (state.lastVertexAddedAt || 0)) <= 600) {
              if (state.vertices.length > 0) {
                state.vertices.pop();
                updatePolyline();
              }
            }
            await attemptSave();
          }
        }
      };
      container.addEventListener('touchstart', onTouchStart, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchstart', fn: onTouchStart, opts: { passive: false } });
      container.addEventListener('touchmove', onTouchMove, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchmove', fn: onTouchMove, opts: { passive: false } });
      container.addEventListener('touchend', onTouchEnd, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchend', fn: onTouchEnd, opts: { passive: false } });
      map.on('move', onMove); state.mouseHandlers.push({ evt: 'move', fn: onMove });
      map.on('dragstart', onDragStart); state.mouseHandlers.push({ evt: 'dragstart', fn: onDragStart });
      map.on('dragend', onDragEnd); state.mouseHandlers.push({ evt: 'dragend', fn: onDragEnd });
      window.addEventListener('map-center-doubletap', onCenterDouble);
      state.domHandlers.push({ el: window, evt: 'map-center-doubletap', fn: onCenterDouble });
      // Suppress default zooming effect on double-tap while drawing
      window.__suppressCenterDoubleAction = true;
    } else {
      // Web: click to add vertex at mouse, move shows guide, double-click to close
      // Use crosshair cursor during drawing for precision
      setDrawingCursor('cross');
      // Temporarily disable double-click zoom to use it for closing polygon
      if (map.doubleClickZoom && typeof map.doubleClickZoom.enabled === 'function') {
        try {
          state.prevDoubleClickZoomEnabled = map.doubleClickZoom.enabled();
          if (state.prevDoubleClickZoomEnabled) map.doubleClickZoom.disable();
        } catch (e) { state.prevDoubleClickZoomEnabled = false; }
      }

      const isNearFirst = (latlng) => {
        if (!(state.vertices.length >= 1 && latlng)) return false;
        // Use pixel distance for consistent UX across zoom levels
        const pFirst = map.latLngToContainerPoint(state.vertices[0]);
        const pCur = map.latLngToContainerPoint(latlng);
        const dx = pCur.x - pFirst.x;
        const dy = pCur.y - pFirst.y;
        return (dx * dx + dy * dy) <= (NEAR_FIRST_THRESHOLD_PX * NEAR_FIRST_THRESHOLD_PX);
      };
      const onClick = (ev) => {
        // Only process click if not in double-click holding mode and not suppressed
        if (isDoubleClickHolding || suppressNextClick) return;
        // If preview is shown, prevent further vertex additions
        if (state.closedPreview) return;
        // If near first vertex and polygon can be closed, do NOT add a new vertex.
        if (state.vertices.length >= 3 && isNearFirst(ev.latlng)) {
          return;
        }
        const latlng = ev.latlng;
        // Immediate add (no defer)
        addVertexAt(latlng);
      };
      const onMouseMove = (ev) => {
        if (!isDoubleClickHolding) {
          setDrawingCursor('cross');
        }
        if (state.tempGuide && state.vertices.length > 0) {
          state.tempGuide.setLatLngs([state.vertices[state.vertices.length - 1], ev.latlng]);
        }
        // Track last mouse latlng for idle proximity evaluation
        state.lastMouseLatLng = ev.latlng;
        // Before first vertex: keep static "click to add vertex"
        if (state.vertices.length === 0) {
          showClickToAdd();
        } else {
          // After first vertex: moving => "click to add vertex"
          showClickToAdd();
        }
        if (state.idleTimer) { try { clearTimeout(state.idleTimer); } catch (e) {} }
        state.idleTimer = setTimeout(() => {
          if (!drawing || drawing !== state) return;
          // Idle: before first vertex stay on click message
          if (state.vertices.length === 0) {
            showClickToAdd();
            return;
          }
          // If enough vertices and near first, prompt to close; else show drag message
          if (state.vertices.length >= 3 && state.lastMouseLatLng && isNearFirst(state.lastMouseLatLng)) {
            showDoubleToClose();
          } else {
            showDragToDraw();
          }
        }, 450);
      };
      
      let lastClickTime = 0;
      let isDoubleClickHolding = false;
      let suppressNextClick = false; // prevent duplicate vertex from touch generating a synthetic click
      let lastTouchTimeWeb = 0;
      const container = map.getContainer();
      // No deferred single-click timer anymore
      const clearSingleClickTimer = () => {};
      const addVertexAt = (latlng, source = 'click') => {
        state.vertices.push(latlng);
        setFirstMarker(state.vertices[0]);
        updatePolyline();
        setDrawingCursor('cross');
        if (state.vertices.length >= 1) {
          showDragToDraw();
        } else {
          showClickToAdd();
        }
        state.lastVertexAddedAt = Date.now();
        state.lastVertexAddedBy = source;
        state.pendingVertexLatLng = null;
      };

      const onMouseDown = (ev) => {
        const now = Date.now();
        const timeSinceLastClick = now - lastClickTime;
        
        // Detect double-click
        if (timeSinceLastClick < 300 && state.vertices.length >= 3 && isNearFirst(ev.latlng)) {
          isDoubleClickHolding = true;
        }
        // Any quick second press should cancel a pending single-click acceptance
        if (timeSinceLastClick < 500) {
          clearSingleClickTimer();
        }
        
        lastClickTime = now;
      };

      const onMouseUp = (ev) => {
        if (isDoubleClickHolding) {
          // Return to cross cursor after releasing
          setDrawingCursor('cross');
          // Complete the polygon
          if (state.isClosing) { isDoubleClickHolding = false; return; }
          state.isClosing = true;
          state.suppressNextDblClick = true;
          setTimeout(() => { state.suppressNextDblClick = false; }, 350);
          // If a vertex was just added moments ago as part of a double-click sequence, remove it
          if (state.lastVertexAddedBy === 'click' && (Date.now() - (state.lastVertexAddedAt || 0)) <= 600) {
            if (state.vertices.length > 0) {
              state.vertices.pop();
              updatePolyline();
            }
          }
          // Show preview immediately to detach line
          showClosedPreview();
          attemptSave();
          isDoubleClickHolding = false;
        } else {
          // Ensure cross cursor is always shown for single clicks
          setDrawingCursor('cross');
        }
      };

      const onDblClick = async (ev) => {
        // Cancel any pending single-click acceptance
        clearSingleClickTimer();
        if (state.suppressNextDblClick || state.isClosing) return;
        // Handle double-click completion (fallback)
        if (state.vertices.length >= 3) {
          if (isNearFirst(ev && ev.latlng)) {
            // If a vertex was just added moments ago as part of a double-click sequence, remove it
            if (state.lastVertexAddedBy === 'click' && (Date.now() - (state.lastVertexAddedAt || 0)) <= 600) {
              if (state.vertices.length > 0) {
                state.vertices.pop();
                updatePolyline();
              }
            }
            state.isClosing = true;
            // Detach line immediately
            showClosedPreview();
            await attemptSave();
          }
        } else {
          state.setStatus && state.setStatus('Need at least 3 points', 'error');
        }
      };

      // Touch support on mobile browsers (outside Telegram)
      const TAP_MOVE_THRESHOLD_PX_WEB = 8;
      let touchStartPt = { x: 0, y: 0 };
      let touchMovedWeb = false;
      const getTouchInfo = (e) => {
        const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || null;
        if (!t) return null;
        const rect = container.getBoundingClientRect();
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;
        const latlng = map.containerPointToLatLng(L.point(x, y));
        return { x, y, latlng };
      };
      const onTouchStartWeb = (ev) => {
        const info = getTouchInfo(ev);
        if (!info) return;
        touchStartPt = { x: info.x, y: info.y };
        touchMovedWeb = false;
      };
      const onTouchMoveWeb = (ev) => {
        const info = getTouchInfo(ev);
        if (!info) return;
        const dx = info.x - touchStartPt.x;
        const dy = info.y - touchStartPt.y;
        if ((dx * dx + dy * dy) > (TAP_MOVE_THRESHOLD_PX_WEB * TAP_MOVE_THRESHOLD_PX_WEB)) {
          touchMovedWeb = true;
        }
        if (state.tempGuide && state.vertices.length > 0) {
          state.tempGuide.setLatLngs([state.vertices[state.vertices.length - 1], info.latlng]);
        }
        // Mobile web: while dragging, prompt to tap to add
        if (state.vertices.length === 0) {
          showClickToAdd();
        } else {
          showClickToAdd();
        }
      };
      const onTouchEndWeb = async (ev) => {
        const now = Date.now();
        const info = getTouchInfo(ev);
        if (!info) return;
        // Prevent the synthetic click Leaflet may emit
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
        if (touchMovedWeb) {
          // Finished panning: show stationary hint
          if (!state.closedPreview && state.vertices.length >= 1) {
            showDragToDraw();
          }
          touchMovedWeb = false;
          return; // treat as pan/drag
        }
        if (state.closedPreview) return; // detached

        if (now - lastTouchTimeWeb < 280) {
          // Double-tap: attempt to finish if near first
          lastTouchTimeWeb = 0;
          // No deferred tap to cancel
          if (state.vertices.length >= 3) {
            if (isNearFirst(info.latlng)) {
              // If a vertex was just added moments ago as part of a double-tap sequence, remove it
              if (state.lastVertexAddedBy === 'tap' && (Date.now() - (state.lastVertexAddedAt || 0)) <= 600) {
                if (state.vertices.length > 0) {
                  state.vertices.pop();
                  updatePolyline();
                }
              }
              // Detach line immediately
              showClosedPreview();
              await attemptSave();
            }
          } else {
            // No announcements
          }
        } else {
          // Single tap: add vertex at touch point
          lastTouchTimeWeb = now;
          suppressNextClick = true;
          setTimeout(() => { suppressNextClick = false; }, 350);
          // Immediate add (no defer)
          const latlngToAdd = info.latlng;
          state.vertices.push(latlngToAdd);
          setFirstMarker(state.vertices[0]);
          updatePolyline();
          setDrawingCursor('cross');
          if (state.vertices.length >= 1) {
            showDragToDraw();
          } else {
            showClickToAdd();
          }
          state.lastVertexAddedAt = Date.now();
          state.lastVertexAddedBy = 'tap';
        }
      };
      map.on('click', onClick); state.mouseHandlers.push({ evt: 'click', fn: onClick });
      map.on('mousemove', onMouseMove); state.mouseHandlers.push({ evt: 'mousemove', fn: onMouseMove });
      map.on('mousedown', onMouseDown); state.mouseHandlers.push({ evt: 'mousedown', fn: onMouseDown });
      map.on('mouseup', onMouseUp); state.mouseHandlers.push({ evt: 'mouseup', fn: onMouseUp });
      map.on('dblclick', onDblClick); state.mouseHandlers.push({ evt: 'dblclick', fn: onDblClick });
      // Touch listeners on container for mobile web
      container.addEventListener('touchstart', onTouchStartWeb, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchstart', fn: onTouchStartWeb, opts: { passive: false } });
      container.addEventListener('touchmove', onTouchMoveWeb, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchmove', fn: onTouchMoveWeb, opts: { passive: false } });
      container.addEventListener('touchend', onTouchEndWeb, { passive: false });
      state.domHandlers.push({ el: container, evt: 'touchend', fn: onTouchEndWeb, opts: { passive: false } });
    }
  }

  // expose for other modules if needed
  window.startRefugeDrawing = startRefugeDrawing;

});
