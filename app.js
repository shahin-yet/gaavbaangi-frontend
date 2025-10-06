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
  
  // Apply Telegram-specific styling and dot only in Telegram; remove dot in web
  const centerDotEl = document.querySelector('.map-center-dot');
  if (isTelegramWebApp) {
    document.body.classList.add('telegram-webapp');
    if (centerDotEl) centerDotEl.style.display = 'block';
  } else {
    if (centerDotEl) centerDotEl.remove();
  }
  
  // Initialize the map
  const map = L.map('map', {
    center: [20.5937, 78.9629], // Centered on India as an example
    zoom: 5,
    zoomControl: !isTelegramWebApp // Hide zoom controls in Telegram
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

  async function loadAndRenderRefuges() {
    try {
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges`);
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.refuges)) {
        refugeLayerGroup.clearLayers();
        data.refuges.forEach(r => {
          try {
            if (r && r.polygon && r.polygon.type === 'Polygon') {
              // GeoJSON coordinates are [lng, lat]; Leaflet expects [lat, lng]
              const latlngs = (r.polygon.coordinates || []).map(ring => ring.map(([lng, lat]) => [lat, lng]));
              if (latlngs.length) {
                const polygon = L.polygon(latlngs, {
                  color: '#1e90ff',
                  weight: 2,
                  fillColor: '#1e90ff',
                  fillOpacity: 0.15
                });
                polygon.addTo(refugeLayerGroup).bindPopup(r.name || 'Refuge');
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

  // Telegram-only: center-dot selector model (select by moving map under the dot)
  if (isTelegramWebApp) {
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

    // Desktop-style double click (if Telegram web triggers it)
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
    
    options.forEach(option => {
      const item = document.createElement('div');
      item.className = 'option-item';
      item.innerHTML = `<i class="${option.icon}"></i>${option.text}`;
      item.onclick = option.action;
      panel.appendChild(item);
    });
    
    button.appendChild(panel);
    
    // Toggle panel on button click
    button.onclick = function(e) {
      e.stopPropagation();
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
      text: 'Route',
      action: function() {
        alert('Route drawing started. This feature will be implemented soon.');
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
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
  }

  function closeSidePanel() {
    sidePanel.classList.remove('show');
    menuOverlay.classList.remove('show');
    sidePanel.setAttribute('aria-hidden', 'true');
    menuOverlay.setAttribute('aria-hidden', 'true');
  }

  if (fabMenu && sidePanel && sideClose && menuOverlay) {
    fabMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      openSidePanel();
    });
    sideClose.addEventListener('click', function (e) {
      e.stopPropagation();
      closeSidePanel();
    });
    menuOverlay.addEventListener('click', closeSidePanel);
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
    const initialMsg = isTelegramWebApp
      ? 'Tap to add vertex. Double-tap near first point to finish.'
      : 'Click to add vertex. Double-click near first point to finish.';
    hud.innerHTML = `
      <div class="hud-row">
        <div class="hud-title">
          <span>Drawing refuge</span>
        </div>
        <button class="hud-cancel" title="Cancel" aria-label="Cancel drawing">✕</button>
      </div>
      <div class="hud-status status-info">${initialMsg}</div>
    `;
    document.body.appendChild(hud);
    hud.querySelector('.hud-cancel').addEventListener('click', () => { onCancel && onCancel(); });
    const statusEl = hud.querySelector('.hud-status');
    const setStatus = (text, kind = 'info') => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.remove('status-info', 'status-error', 'status-success');
      statusEl.classList.add(`status-${kind}`);
    };
    return { hud, setStatus };
  }

  function teardownDrawing() {
    if (!drawing) return;
    map.getContainer().style.cursor = '';
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
    if (drawing.polyline) refugeLayerGroup.removeLayer(drawing.polyline);
    if (drawing.firstMarker) refugeLayerGroup.removeLayer(drawing.firstMarker);
    if (drawing.tempGuide) refugeLayerGroup.removeLayer(drawing.tempGuide);
    const hud = document.querySelector('.drawing-hud');
    if (hud) hud.remove();
    const dot = document.querySelector('.map-center-dot');
    if (dot) dot.classList.remove('near-first');
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

  async function saveRefugePolygon(latlngs, setStatus) {
    // Ensure closed ring and convert to GeoJSON lon/lat
    const ring = latlngs.map(ll => [ll.lng, ll.lat]);
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    }
    setStatus && setStatus('Enter a name in the dialog…', 'info');
    const name = prompt('Name this refuge:');
    if (!name) { setStatus && setStatus('Cancelled naming. Continue drawing or cancel.', 'error'); return; }
    try {
      setStatus && setStatus('Saving…', 'info');
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, polygon: { type: 'Polygon', coordinates: [ring] } })
      });
      const data = await res.json();
      if (data.status === 'success') {
        await loadAndRenderRefuges();
        setStatus && setStatus('Saved.', 'success');
      } else {
        setStatus && setStatus('Failed to save refuge.', 'error');
      }
    } catch (e) {
      setStatus && setStatus('Error saving refuge.', 'error');
    }
  }

  function startRefugeDrawing() {
    if (drawing) teardownDrawing();
    const hudApi = createDrawingHud(() => teardownDrawing());

    const state = {
      mode: isTelegramWebApp ? 'telegram' : 'web',
      vertices: [], // array of L.LatLng
      polyline: L.polyline([], { color: '#ff5722', weight: 2 }).addTo(refugeLayerGroup),
      firstMarker: null,
      tempGuide: null,
      mouseHandlers: [],
      domHandlers: [],
      prevDoubleClickZoomEnabled: false,
      lastTouchTime: 0,
      setStatus: hudApi.setStatus
    };
    drawing = state;

    const NEAR_FIRST_THRESHOLD_M = 20; // proximity to first point to allow close

    const updatePolyline = () => {
      state.polyline.setLatLngs(state.vertices);
      if (state.vertices.length > 0) {
        if (!state.tempGuide) {
          state.tempGuide = L.polyline([], { color: '#ff5722', dashArray: '4,6', weight: 2 }).addTo(refugeLayerGroup);
        }
      }
    };

    const setFirstMarker = (latlng) => {
      if (state.firstMarker) return;
      state.firstMarker = L.circleMarker(latlng, { radius: 5, color: '#1e90ff', fillColor: '#1e90ff', fillOpacity: 0.9 }).addTo(refugeLayerGroup);
    };

    if (state.mode === 'telegram') {
      // Telegram: tapping anywhere adds center point; double tap closes
      // Use crosshair cursor during drawing
      setDrawingCursor('cross');
      // Ensure crosshair cursor appears
      map.getContainer().style.cursor = 'crosshair';
      const container = map.getContainer();
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
        // Double-tap is handled globally; skip adding during double-tap window
        if (now - state.lastTouchTime < 280) {
          state.lastTouchTime = 0;
          return;
        }
        state.lastTouchTime = now;
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
        const latlng = map.getCenter();
        state.vertices.push(latlng);
        setFirstMarker(state.vertices[0]);
        updatePolyline();
        state.setStatus && state.setStatus('Tap to add vertex. Double-tap near first point to finish.', 'info');
      };
      const onMove = () => {
        if (state.tempGuide && state.vertices.length > 0) {
          state.tempGuide.setLatLngs([state.vertices[state.vertices.length - 1], map.getCenter()]);
        }
        // proximity check to first vertex for center-dot highlight
        const dot = document.querySelector('.map-center-dot');
        if (dot && state.vertices.length >= 2) {
          const first = state.vertices[0];
          const center = map.getCenter();
          const d = center.distanceTo(first);
          if (d <= NEAR_FIRST_THRESHOLD_M) {
            dot.classList.add('near-first');
            if (state.vertices.length >= 3) state.setStatus && state.setStatus('Double-tap to finish', 'info');
          } else {
            dot.classList.remove('near-first');
          }
        }
      };
      const onCenterDouble = async () => {
        if (state.vertices.length >= 3) {
          const center = map.getCenter();
          const first = state.vertices[0];
          const d = center.distanceTo(first);
          if (d <= NEAR_FIRST_THRESHOLD_M) {
            // Keep crosshair cursor
            setDrawingCursor('cross');
            // close polygon
            await saveRefugePolygon(state.vertices, state.setStatus);
            teardownDrawing();
          } else {
            state.setStatus && state.setStatus('Move near first point to close', 'error');
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
        return state.vertices.length >= 1 && latlng && latlng.distanceTo(state.vertices[0]) <= NEAR_FIRST_THRESHOLD_M;
      };
      const onClick = (ev) => {
        // Only process click if not in double-click holding mode
        if (!isDoubleClickHolding) {
          const latlng = ev.latlng;
          state.vertices.push(latlng);
          setFirstMarker(state.vertices[0]);
          updatePolyline();
          setDrawingCursor('cross');
          state.setStatus && state.setStatus('Click to add vertex. Double-click near first point to finish.', 'info');
        }
      };
      const onMouseMove = (ev) => {
        if (!isDoubleClickHolding) {
          setDrawingCursor('cross');
        }
        if (state.tempGuide && state.vertices.length > 0) {
          state.tempGuide.setLatLngs([state.vertices[state.vertices.length - 1], ev.latlng]);
        }
      };
      
      let lastClickTime = 0;
      let isDoubleClickHolding = false;

      const onMouseDown = (ev) => {
        const now = Date.now();
        const timeSinceLastClick = now - lastClickTime;
        
        // Detect double-click
        if (timeSinceLastClick < 300 && state.vertices.length >= 3 && isNearFirst(ev.latlng)) {
          isDoubleClickHolding = true;
        }
        
        lastClickTime = now;
      };

      const onMouseUp = (ev) => {
        if (isDoubleClickHolding) {
          // Return to cross cursor after releasing
          setDrawingCursor('cross');
          // Complete the polygon
          saveRefugePolygon(state.vertices, state.setStatus).then(() => {
            teardownDrawing();
          });
          isDoubleClickHolding = false;
        } else {
          // Ensure cross cursor is always shown for single clicks
          setDrawingCursor('cross');
        }
      };

      const onDblClick = async (ev) => {
        // Handle double-click completion (fallback)
        if (state.vertices.length >= 3) {
          if (isNearFirst(ev && ev.latlng)) {
            await saveRefugePolygon(state.vertices, state.setStatus);
            teardownDrawing();
          } else {
            state.setStatus && state.setStatus('Move near first point to close', 'error');
          }
        } else {
          state.setStatus && state.setStatus('Need at least 3 points', 'error');
        }
      };
      map.on('click', onClick); state.mouseHandlers.push({ evt: 'click', fn: onClick });
      map.on('mousemove', onMouseMove); state.mouseHandlers.push({ evt: 'mousemove', fn: onMouseMove });
      map.on('mousedown', onMouseDown); state.mouseHandlers.push({ evt: 'mousedown', fn: onMouseDown });
      map.on('mouseup', onMouseUp); state.mouseHandlers.push({ evt: 'mouseup', fn: onMouseUp });
      map.on('dblclick', onDblClick); state.mouseHandlers.push({ evt: 'dblclick', fn: onDblClick });
    }
  }

  // expose for other modules if needed
  window.startRefugeDrawing = startRefugeDrawing;

});
