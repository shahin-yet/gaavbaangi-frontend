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
  
  // Initialize the map (start fully zoomed out; first tap zooms to country scale)
  const COUNTRY_ZOOM = 5;
  const WORLD_ZOOM_DESKTOP = 2.5;
  const WORLD_ZOOM_MOBILE = 2;
  const WORLD_ZOOM = isMobile ? WORLD_ZOOM_MOBILE : WORLD_ZOOM_DESKTOP;
  const MAP_CENTER_DESKTOP = [36.9378185, 7.5800675];
  const MAP_CENTER_MOBILE = [0, 0];
  const MAP_CENTER = isMobile ? MAP_CENTER_MOBILE : MAP_CENTER_DESKTOP;
  const DOUBLE_TAP_ZOOM_INCREMENT = 2;
  const map = L.map('map', {
    center: MAP_CENTER,
    zoom: WORLD_ZOOM,
    zoomControl: true,
    zoomSnap: 0.5,
    zoomDelta: 0.5
  });
  let hasCompletedFirstZoom = false;
  const markFirstZoomComplete = () => {
    if (hasCompletedFirstZoom) return;
    hasCompletedFirstZoom = true;
    try { setRefugePolygonsInteractive(true); } catch (e) {}
  };
  map.whenReady(() => {
    try {
      map.fitWorld({ animate: false });
      // fitWorld recalculates zoom, so re-apply configured world zoom afterwards
      map.setView(MAP_CENTER, WORLD_ZOOM, { animate: false });
      setTimeout(() => map.invalidateSize(), 0);
    } catch (e) {}
  });
  map.once('click', (ev) => {
    const firstTapTarget = isMobile ? map.getCenter() : ev.latlng;
    try {
      map.flyTo(firstTapTarget, COUNTRY_ZOOM, { duration: 0.7, easeLinearity: 0.4 });
    } catch (err) {
      map.setView(firstTapTarget, COUNTRY_ZOOM);
    }
    // Release initial interaction guard after the first zoom attempt
    markFirstZoomComplete();
  });
  if (isMobile) {
    try { map.doubleClickZoom.disable(); } catch (e) {}
    // Block double-click zoom on mobile; touch handler below dispatches events without zooming
    map.on('dblclick', (ev) => {
      if (ev && ev.originalEvent) {
        ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
        ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
      }
    });
  }
  let userLocationMarker = null;

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
  if (!hasCompletedFirstZoom) {
    try { setRefugePolygonsInteractive(false); } catch (e) {}
  }

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

  // Helper: Check if two polygons overlap
  function polygonsOverlap(polygon1LatLngs, polygon2GeoJSON) {
    // Convert polygon1 (overlay) latlngs to array format
    const poly1Points = polygon1LatLngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));
    
    // Extract coordinates from GeoJSON polygon2 (refuge)
    let poly2Rings = [];
    if (polygon2GeoJSON.type === 'Polygon') {
      poly2Rings = polygon2GeoJSON.coordinates.map(ring => 
        ring.map(([lng, lat]) => ({ lat, lng }))
      );
    } else if (polygon2GeoJSON.type === 'MultiPolygon') {
      polygon2GeoJSON.coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          poly2Rings.push(ring.map(([lng, lat]) => ({ lat, lng })));
        });
      });
    }
    
    if (!poly2Rings.length) return false;
    
    // Point-in-polygon test using ray casting
    const pointInPolygon = (point, polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;
        const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
          (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    
    // Check if any point of poly1 is inside any ring of poly2
    for (const point of poly1Points) {
      for (const ring of poly2Rings) {
        if (pointInPolygon(point, ring)) {
          return true;
        }
      }
    }
    
    // Check if any point of poly2 is inside poly1
    for (const ring of poly2Rings) {
      for (const point of ring) {
        if (pointInPolygon(point, poly1Points)) {
          return true;
        }
      }
    }
    
    // Check for edge intersections
    const segmentsIntersect = (p1, p2, p3, p4) => {
      const ccw = (A, B, C) => (C.lat - A.lat) * (B.lng - A.lng) > (B.lat - A.lat) * (C.lng - A.lng);
      return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
    };
    
    // Check each edge of poly1 against each edge of poly2
    for (let i = 0; i < poly1Points.length; i++) {
      const p1 = poly1Points[i];
      const p2 = poly1Points[(i + 1) % poly1Points.length];
      
      for (const ring of poly2Rings) {
        for (let j = 0; j < ring.length; j++) {
          const p3 = ring[j];
          const p4 = ring[(j + 1) % ring.length];
          if (segmentsIntersect(p1, p2, p3, p4)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  // Helper: determine if an overlay fully contains the refuge (all refuge points are inside)
  function overlayFullyContainsRefuge(overlayLatLngs, refugeGeoJSON) {
    if (!Array.isArray(overlayLatLngs) || !refugeGeoJSON) return false;

    const overlayPoints = overlayLatLngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));

    let refugeRings = [];
    if (refugeGeoJSON.type === 'Polygon') {
      refugeRings = refugeGeoJSON.coordinates.map(ring =>
        ring.map(([lng, lat]) => ({ lat, lng }))
      );
    } else if (refugeGeoJSON.type === 'MultiPolygon') {
      refugeGeoJSON.coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          refugeRings.push(ring.map(([lng, lat]) => ({ lat, lng })));
        });
      });
    }
    if (!refugeRings.length) return false;

    const pointInPolygon = (point, polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;
        const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
          (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // All points of every refuge ring must be inside overlay
    return refugeRings.every(ring => ring.every(point => pointInPolygon(point, overlayPoints)));
  }

  function openRefugeEditor(refuge) {
    // Reuse drawing HUD for a consistent look
    let overlayBtn = null;
    let adjoinBtn = null;
    let subtractBtn = null;
    let saveBtn = null;
    let overlayIdCounter = 0;

    const overlaySelectionState = {
      mode: null,
      adjoin: new Set(),
      subtract: new Set()
    };

    // Default no-op placeholders; assigned once HUD actions are ready
    let showSelectionStatus = () => {};
    let showDrawOverlayPrompt = () => {};
    let startOverlayLoop = () => {};
    let updateUndoButtonState = () => {};
    const selectionHistory = {
      adjoin: [],
      subtract: []
    };
    const overlayDrawingUndoState = {
      enabled: false,
      handler: null
    };

    window.__overlayDrawingLocked = false;

    const baseOverlayStyle = {
      color: '#ff9800',
      weight: 2,
      fillColor: '#ff9800',
      fillOpacity: 0.2
    };

    const adjoinOverlayStyle = {
      color: '#4caf50',
      weight: 3,
      fillColor: '#4caf50',
      fillOpacity: 0.35
    };

    const subtractOverlayStyle = {
      color: '#f44336',
      weight: 3,
      fillColor: '#f44336',
      fillOpacity: 0.35
    };

    // Keep smaller/inner overlays on top so they remain selectable when overlapping.
    const computeOverlayArea = (layer) => {
      if (!layer || typeof layer.getLatLngs !== 'function') return Infinity;
      try {
        const latlngs = layer.getLatLngs();
        const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
        if (!Array.isArray(coords) || coords.length < 3) return Infinity;
        let area = 0;
        const n = coords.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          area += coords[i].lng * coords[j].lat;
          area -= coords[j].lng * coords[i].lat;
        }
        return Math.abs(area / 2);
      } catch (e) {
        return Infinity;
      }
    };

    const reorderOverlayRenderOrder = () => {
      if (!Array.isArray(window.__editOverlayLayers) || window.__editOverlayLayers.length === 0) return;
      const ordered = window.__editOverlayLayers
        .filter(layer => !!layer)
        .map(layer => ({ layer, area: computeOverlayArea(layer) }))
        .sort((a, b) => a.area - b.area);
      // Bring larger polygons forward first so the smallest/inner overlays end up on top.
      for (let i = ordered.length - 1; i >= 0; i -= 1) {
        const entry = ordered[i];
        try {
          if (entry.layer && typeof entry.layer.bringToFront === 'function') {
            entry.layer.bringToFront();
          }
        } catch (e) {}
      }
    };

    const applyOverlayStyle = (layer) => {
      if (!layer || typeof layer.setStyle !== 'function') return;
      let style = baseOverlayStyle;
      if (overlaySelectionState.adjoin.has(layer)) {
        style = adjoinOverlayStyle;
      } else if (overlaySelectionState.subtract.has(layer)) {
        style = subtractOverlayStyle;
      }
      try {
        layer.setStyle(style);
      } catch (e) {}
    };

    const updateAllOverlayStyles = () => {
      if (!Array.isArray(window.__editOverlayLayers)) return;
      window.__editOverlayLayers.forEach(layer => applyOverlayStyle(layer));
    };

    const updateSelectionButtons = () => {
      if (adjoinBtn) {
        adjoinBtn.classList.toggle('active', overlaySelectionState.mode === 'adjoin');
      }
      if (subtractBtn) {
        subtractBtn.classList.toggle('active', overlaySelectionState.mode === 'subtract');
      }
    };

    const clearSelectionState = (options = {}) => {
      const opts = options || {};
      const preserveMode = !!opts.preserveMode;
      const skipStyles = !!opts.skipStyles;
      overlaySelectionState.adjoin.clear();
      overlaySelectionState.subtract.clear();
      selectionHistory.adjoin = [];
      selectionHistory.subtract = [];
      if (!preserveMode) {
        overlaySelectionState.mode = null;
        window.__overlayDrawingLocked = false;
      }
      if (!skipStyles) {
        updateAllOverlayStyles();
      }
      updateSelectionButtons();
      updateUndoButtonState();
    };

    const setSelectionMode = (mode) => {
      const normalized = mode === 'adjoin'
        ? 'adjoin'
        : (mode === 'subtract' ? 'subtract' : null);
      const previousMode = overlaySelectionState.mode;
      const newMode = (previousMode === normalized) ? null : normalized;

      overlaySelectionState.mode = newMode;
      window.__overlayDrawingLocked = newMode !== null;
      updateSelectionButtons();
      if (newMode !== null) {
        showSelectionStatus('select the overlays');
      }

      // When entering a selection mode, immediately pause any active overlay drawing
      if (newMode !== null && previousMode === null) {
        if (window.__editOverlayActive) {
          // This will teardown the current drawing loop but keep the HUD
          try {
            stopOverlayLoop();
          } catch (e) {}
        }
      }

      // When leaving selection mode (tapping the same button again), resume drawing
      if (newMode === null && previousMode !== null) {
        if (window.__editing) {
          try {
            window.__editOverlayActive = false;
            // Lock is already cleared above, just restart the overlay loop
            startOverlayLoop();
          } catch (e) {}
        }
        showDrawOverlayPrompt();
      }

      return overlaySelectionState.mode;
    };

    const hasAvailableOverlays = () =>
      Array.isArray(window.__editOverlayLayers) && window.__editOverlayLayers.some(layer => !!layer);

    const updateOperationButtonsState = () => {
      const hasOverlays = hasAvailableOverlays();
      if (adjoinBtn) {
        adjoinBtn.disabled = !hasOverlays;
        if (!hasOverlays) {
          adjoinBtn.title = 'Draw an overlay to enable adjoin';
        } else {
          adjoinBtn.removeAttribute('title');
        }
      }
      if (subtractBtn) {
        subtractBtn.disabled = !hasOverlays;
        if (!hasOverlays) {
          subtractBtn.title = 'Draw an overlay to enable subtract';
        } else {
          subtractBtn.removeAttribute('title');
        }
      }
      if (!hasOverlays && overlaySelectionState.mode !== null) {
        setSelectionMode(null);
        showSelectionStatus('No overlays available. Draw an overlay to modify the refuge.');
      }
    };

    const pruneSelectionHistoryForLayer = (layer) => {
      if (!layer) return;
      ['adjoin', 'subtract'].forEach(mode => {
        selectionHistory[mode] = selectionHistory[mode].filter(entry => entry !== layer);
      });
    };

    const updateOverlayContainmentLocks = () => {
      if (!Array.isArray(window.__editOverlayLayers) || window.__editOverlayLayers.length === 0) return;
      const layers = window.__editOverlayLayers.filter(layer => layer && typeof layer.getLatLngs === 'function');
      if (!layers.length) return;

      const coordsCache = new Map();
      layers.forEach(layer => {
        try {
          const latlngs = layer.getLatLngs();
          coordsCache.set(layer, Array.isArray(latlngs[0]) ? latlngs[0] : latlngs);
        } catch (e) {
          coordsCache.set(layer, null);
        }
        layer._adjoinLocked = false;
      });

      const pointInPolygon = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].lng, yi = polygon[i].lat;
          const xj = polygon[j].lng, yj = polygon[j].lat;
          const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const containmentCounts = new Map();
      layers.forEach(layer => containmentCounts.set(layer, 0));

      const layersToRemove = new Set();

      layers.forEach(inner => {
        const innerCoords = coordsCache.get(inner);
        if (!innerCoords || innerCoords.length < 3) return;
        const innerPoints = innerCoords.map(ll => ({ lat: ll.lat, lng: ll.lng }));
        layers.forEach(outer => {
          if (inner === outer) return;
          const outerCoords = coordsCache.get(outer);
          if (!outerCoords || outerCoords.length < 3) return;
          const outerPoly = outerCoords.map(ll => ({ lat: ll.lat, lng: ll.lng }));
          const fullyInside = innerPoints.every(pt => pointInPolygon(pt, outerPoly));
          if (fullyInside) {
            containmentCounts.set(inner, (containmentCounts.get(inner) || 0) + 1);
          }
        });
      });

      let changed = false;
      layers.forEach(layer => {
        const containments = containmentCounts.get(layer) || 0;
        if (containments > 1) {
          layersToRemove.add(layer);
          return;
        }
        const locked = containments === 1;
        if (layer._adjoinLocked !== locked) {
          layer._adjoinLocked = locked;
          changed = true;
        }
        if (locked && overlaySelectionState.adjoin.has(layer)) {
          overlaySelectionState.adjoin.delete(layer);
          pruneSelectionHistoryForLayer(layer);
          changed = true;
        }
      });

      if (layersToRemove.size) {
        layersToRemove.forEach(layer => {
          try { refugeLayerGroup.removeLayer(layer); } catch (e) {}
          overlaySelectionState.adjoin.delete(layer);
          overlaySelectionState.subtract.delete(layer);
          pruneSelectionHistoryForLayer(layer);
          const idx = window.__editOverlayLayers.indexOf(layer);
          if (idx > -1) {
            window.__editOverlayLayers.splice(idx, 1);
          }
        });
        changed = true;
      }

      if (changed) {
        updateAllOverlayStyles();
        updateUndoButtonState();
        updateOperationButtonsState();
        reorderOverlayRenderOrder();
      }
    };

    const toggleOverlaySelection = (layer) => {
      const activeMode = overlaySelectionState.mode;
      if (!layer || !activeMode) {
        return { changed: false, selected: false, mode: activeMode };
      }
    if (activeMode === 'subtract' && layer._subtractLocked) {
      return { changed: false, selected: false, mode: activeMode, reason: 'subtract-locked' };
    }
      if (activeMode === 'adjoin' && layer._adjoinLocked) {
        return { changed: false, selected: false, mode: activeMode, reason: 'adjoin-locked' };
      }
      const activeSet = activeMode === 'adjoin' ? overlaySelectionState.adjoin : overlaySelectionState.subtract;
      const otherSet = activeMode === 'adjoin' ? overlaySelectionState.subtract : overlaySelectionState.adjoin;
      if (activeSet.has(layer)) {
        return { changed: false, selected: true, mode: activeMode, reason: 'already-selected' };
      }
      if (otherSet.has(layer)) {
        const lockedRole = activeMode === 'adjoin' ? 'subtract' : 'adjoin';
        return { changed: false, selected: false, mode: activeMode, reason: 'locked-to-other', lockedRole };
      }
      activeSet.add(layer);
      layer._selectionRole = activeMode;
      applyOverlayStyle(layer);
      if (selectionHistory[activeMode]) {
        selectionHistory[activeMode].push(layer);
      }
      updateUndoButtonState();
      return { changed: true, selected: true, mode: activeMode };
    };

    const resetOverlayButton = () => {
      if (!overlayBtn) return;
      if (window.__editOverlayActive) {
        overlayBtn.disabled = true;
        overlayBtn.textContent = 'Drawing…';
      } else {
        const locked = !!window.__overlayDrawingLocked;
        overlayBtn.disabled = locked;
        overlayBtn.textContent = locked ? 'Draw overlay' : 'Draw overlay';
      }
    };

    const cleanupEditOverlays = () => {
      if (Array.isArray(window.__editOverlayLayers)) {
        window.__editOverlayLayers.forEach(layer => {
          if (!layer) return;
          try {
            overlaySelectionState.adjoin.delete(layer);
            overlaySelectionState.subtract.delete(layer);
            pruneSelectionHistoryForLayer(layer);
            if (refugeLayerGroup && typeof refugeLayerGroup.removeLayer === 'function') {
              refugeLayerGroup.removeLayer(layer);
            }
          } catch (e) {}
        });
      }
      window.__editOverlayLayers = [];
      clearSelectionState({ skipStyles: true });
      updateOperationButtonsState();
    };

    const buildOverlayGeoJSONFromLatLngs = (latlngs) => {
      if (!Array.isArray(latlngs) || latlngs.length < 3) return null;
      const ring = latlngs.map(ll => [ll.lng, ll.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        ring.push(first);
      }
      return {
        type: 'Polygon',
        coordinates: [ring]
      };
    };

    const validateOverlayDoesNotFragment = async (overlayGeoJSON) => {
      if (!overlayGeoJSON || !refuge || !refuge.id) return { ok: true };
      try {
        const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges/${refuge.id}/validate-overlay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'subtract',
            overlay: overlayGeoJSON
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.status === 'success') {
          return { ok: true };
        }
        return {
          ok: false,
          message: (data && data.message) || 'Overlay validation failed',
          code: data && data.code
        };
      } catch (e) {
        return { ok: false, message: 'Failed to validate overlay. Check your connection.' };
      }
    };

    const stopOverlayLoop = () => {
      window.__editOverlayActive = false;
      resetOverlayButton();
      overlayDrawingUndoState.enabled = false;
      overlayDrawingUndoState.handler = null;
      updateUndoButtonState();
      try {
        teardownDrawing({ preserveHud: true });
      } catch (e) {}
    };
    
    // Highlight the refuge being edited by adding fill
    const highlightEditingRefuge = () => {
      refugeLayerGroup.eachLayer(layer => {
        if (layer._refuge && layer._refuge.id === refuge.id) {
          try {
            layer.setStyle({ fillOpacity: 0.15 });
            window.__editingRefugeLayer = layer;
          } catch (e) {}
        }
      });
    };
    
    // Remove fill from the refuge when done editing
    const unhighlightEditingRefuge = () => {
      if (window.__editingRefugeLayer) {
        try {
          window.__editingRefugeLayer.setStyle({ fillOpacity: 0 });
        } catch (e) {}
        window.__editingRefugeLayer = null;
      }
    };
    
    const beginEditing = () => {
      try { document.body.classList.add('editing-active'); } catch (e) {}
      window.__editing = true;
      window.__overlayDrawingLocked = false;
      // Keep map interactions available during edit; do not add a global blocker overlay
      try { window.__editBlocker = null; } catch (e) {}
      cleanupEditOverlays();
      window.__editOverlayCache = [];
      window.__editOverlayActive = false;
      resetOverlayButton();
      highlightEditingRefuge();
    };
    const endEditing = () => {
      stopOverlayLoop();
      if (drawing) {
        teardownDrawing();
      }
      // Remove any overlays that don't overlap with the refuge before cleanup
      if (Array.isArray(window.__editOverlayLayers) && window.__editOverlayLayers.length > 0) {
        const overlaysToRemove = [];
        window.__editOverlayLayers.forEach((layer, index) => {
          if (!layer || !layer.getLatLngs) return;
          try {
            const latlngs = layer.getLatLngs();
            const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
            const overlaps = polygonsOverlap(coords, refuge.polygon);
            if (!overlaps) {
              overlaysToRemove.push(layer);
            }
          } catch (e) {
            // If validation fails, keep the overlay for safety
          }
        });
        // Remove non-overlapping overlays
        overlaysToRemove.forEach(layer => {
          try {
            refugeLayerGroup.removeLayer(layer);
            overlaySelectionState.adjoin.delete(layer);
            overlaySelectionState.subtract.delete(layer);
            pruneSelectionHistoryForLayer(layer);
            const idx = window.__editOverlayLayers.indexOf(layer);
            if (idx > -1) {
              window.__editOverlayLayers.splice(idx, 1);
            }
          } catch (e) {}
        });
        
        // Check for fully overlapping overlays and remove smallest ones
        if (window.__editOverlayLayers.length > 1) {
          const fullyOverlappedLayers = new Set();
          
          // Helper function to check if polygon1 fully contains polygon2
          const fullyContains = (poly1LatLngs, poly2LatLngs) => {
            const poly1Points = poly1LatLngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));
            const poly2Points = poly2LatLngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));
            
            // Point-in-polygon test
            const pointInPolygon = (point, polygon) => {
              let inside = false;
              for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].lng, yi = polygon[i].lat;
                const xj = polygon[j].lng, yj = polygon[j].lat;
                const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
                  (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
              }
              return inside;
            };
            
            // Check if all points of poly2 are inside poly1
            for (const point of poly2Points) {
              if (!pointInPolygon(point, poly1Points)) {
                return false;
              }
            }
            return true;
          };
          
          // Helper function to calculate polygon area (approximate)
          const calculateArea = (latlngs) => {
            let area = 0;
            const n = latlngs.length;
            for (let i = 0; i < n; i++) {
              const j = (i + 1) % n;
              area += latlngs[i].lng * latlngs[j].lat;
              area -= latlngs[j].lng * latlngs[i].lat;
            }
            return Math.abs(area / 2);
          };
          
          // Compare each pair of overlays
          for (let i = 0; i < window.__editOverlayLayers.length; i++) {
            const layer1 = window.__editOverlayLayers[i];
            if (!layer1 || !layer1.getLatLngs || fullyOverlappedLayers.has(layer1)) continue;
            
            try {
              const latlngs1 = layer1.getLatLngs();
              const coords1 = Array.isArray(latlngs1[0]) ? latlngs1[0] : latlngs1;
              const area1 = calculateArea(coords1);
              
              for (let j = 0; j < window.__editOverlayLayers.length; j++) {
                if (i === j) continue;
                
                const layer2 = window.__editOverlayLayers[j];
                if (!layer2 || !layer2.getLatLngs || fullyOverlappedLayers.has(layer2)) continue;
                
                try {
                  const latlngs2 = layer2.getLatLngs();
                  const coords2 = Array.isArray(latlngs2[0]) ? latlngs2[0] : latlngs2;
                  const area2 = calculateArea(coords2);
                  
                  // Check if one fully contains the other
                  const layer1ContainsLayer2 = fullyContains(coords1, coords2);
                  const layer2ContainsLayer1 = fullyContains(coords2, coords1);
                  
                  if (layer1ContainsLayer2 || layer2ContainsLayer1) {
                    // Mark the smaller one for removal
                    if (area1 < area2) {
                      fullyOverlappedLayers.add(layer1);
                    } else {
                      fullyOverlappedLayers.add(layer2);
                    }
                  }
                } catch (e) {}
              }
            } catch (e) {}
          }
          
          // Remove fully overlapped layers
          fullyOverlappedLayers.forEach(layer => {
            try {
              refugeLayerGroup.removeLayer(layer);
              overlaySelectionState.adjoin.delete(layer);
              overlaySelectionState.subtract.delete(layer);
              pruneSelectionHistoryForLayer(layer);
              const idx = window.__editOverlayLayers.indexOf(layer);
              if (idx > -1) {
                window.__editOverlayLayers.splice(idx, 1);
              }
            } catch (e) {}
          });
        }
      }
      cleanupEditOverlays();
      unhighlightEditingRefuge();
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
    // Keep status area reserved for alerts only (red/green)
    const statusEl = hud.querySelector('.hud-status');
    if (statusEl) { statusEl.innerHTML = ''; statusEl.style.display = 'none'; }
    const baseSetStatus = hudApi && hudApi.setStatus ? hudApi.setStatus : null;
    if (hudApi) {
      hudApi.setStatus = (text, kind = 'info') => {
        if (kind === 'error' || kind === 'success') {
          baseSetStatus && baseSetStatus(text, kind);
          try { statusEl && (statusEl.style.display = ''); } catch (e) {}
        }
      };
    }
    // Remove the drawing undo row in edit mode (edit mode has its own undo button)
    const drawingUndoRow = hud.querySelector('.hud-drawing-undo-row');
    if (drawingUndoRow) { try { drawingUndoRow.remove(); } catch (e) {} }
    // Remove name input and Save button entirely in edit mode; keep actions area visible
    const controls = hud.querySelector('.hud-controls');
    const inputEl = hud.querySelector('.hud-name');
    if (inputEl) { try { inputEl.remove(); } catch (e) {} }
    const okBtn = hud.querySelector('.hud-ok');
    if (okBtn) { try { okBtn.remove(); } catch (e) {} }
    if (controls) { controls.style.display = ''; }
    const actions = hud.querySelector('.hud-actions');
    if (actions) {
      const getSelectionCountsText = () =>
        `add: ${overlaySelectionState.adjoin.size}, sub: ${overlaySelectionState.subtract.size}`;

      const setHelperStatus = (text) => {
        const normalized = typeof text === 'string' ? text.trim() : '';
        if (!normalized) return;
        if (baseSetStatus) {
          baseSetStatus(normalized, 'info');
        } else if (statusEl) {
          statusEl.innerHTML = normalized;
          statusEl.classList.remove('status-error', 'status-success');
          statusEl.classList.add('status-info');
        }
        if (statusEl) {
          statusEl.style.display = '';
        }
      };

      showSelectionStatus = (message) => {
        const normalized = typeof message === 'string' ? message.trim() : '';
        if (normalized) {
          setHelperStatus(normalized);
          return;
        }
        if (overlaySelectionState.mode !== null) {
          const hasSelection = overlaySelectionState.adjoin.size > 0 || overlaySelectionState.subtract.size > 0;
          setHelperStatus(hasSelection ? getSelectionCountsText() : 'select the overlays');
          return;
        }
        setHelperStatus('draw overlays to modify refuge');
      };

      showDrawOverlayPrompt = () => {
        setHelperStatus('draw overlays to modify refuge');
      };

      showSelectionStatus('draw overlays to modify refuge');

      const handleOverlayInteraction = (evt) => {
        const layer = evt && evt.target;
        if (!layer) return;
        const now = Date.now();
        if (evt && evt.type === 'click' && layer._lastTouchSelection && (now - layer._lastTouchSelection) < 450) {
          return;
        }
        if (evt && evt.type === 'touchstart') {
          layer._lastTouchSelection = now;
        } else {
          layer._lastTouchSelection = now;
        }
        if (!overlaySelectionState.mode) {
          showSelectionStatus('Tap Adjoin or Subtract to start selecting overlays.');
          if (evt && evt.originalEvent && typeof evt.originalEvent.preventDefault === 'function') {
            evt.originalEvent.preventDefault();
          }
          if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
          return;
        }
        const result = toggleOverlaySelection(layer);
        if (result.reason === 'subtract-locked') {
          showSelectionStatus('Subtract not allowed for this overlay');
        } else if (result.reason === 'adjoin-locked') {
          showSelectionStatus('Adjoin not allowed for nested overlay');
        } else if (result.changed || result.reason === 'already-selected' || result.reason === 'locked-to-other') {
          showSelectionStatus(getSelectionCountsText());
        }
        if (evt && evt.originalEvent && typeof evt.originalEvent.preventDefault === 'function') {
          evt.originalEvent.preventDefault();
        }
        if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
      };

      const registerOverlayLayer = (layer) => {
        if (!layer || layer._selectionRegistered) return;
        layer._selectionRegistered = true;
        overlayIdCounter += 1;
        layer._overlayId = `edit-overlay-${overlayIdCounter}`;
        layer._selectionRole = null;
        if (typeof layer.on === 'function') {
          layer.on('click', handleOverlayInteraction);
          layer.on('touchstart', handleOverlayInteraction);
        }
        applyOverlayStyle(layer);
      };

      const createOverlayHudApi = () => ({
        hud,
        setStatus: () => {},
        getName: () => '',
        focusName: () => {},
        showNameBar: () => {},
        hideNameBar: () => {},
        hideOk: () => {},
        showOk: () => {},
        setUndoEnabled: (enabled) => {
          overlayDrawingUndoState.enabled = !!enabled;
          updateUndoButtonState();
        },
        hideUndoRow: () => {},
        showUndoRow: () => {},
        setUndoHandler: (cb) => {
          overlayDrawingUndoState.handler = (typeof cb === 'function') ? cb : null;
        }
      });
      startOverlayLoop = () => {
        if (window.__editOverlayActive) return;
        // Block overlay drawing if a selection mode is active
        if (overlaySelectionState.mode !== null) return;
        if (window.__overlayDrawingLocked) {
          window.__editOverlayActive = false;
          resetOverlayButton();
          return;
        }
        window.__editOverlayActive = true;
        resetOverlayButton();
        overlayDrawingUndoState.enabled = false;
        overlayDrawingUndoState.handler = null;
        updateUndoButtonState();
        const overlayHudApi = createOverlayHudApi();
        const run = () => {
          if (!window.__editing || !window.__editOverlayActive) {
            stopOverlayLoop();
            return;
          }
          // Block overlay drawing if a selection mode is active
          if (overlaySelectionState.mode !== null) {
            stopOverlayLoop();
            return;
          }
          if (window.__overlayDrawingLocked) {
            stopOverlayLoop();
            return;
          }
          startRefugeDrawing({
            skipSaving: true,
            preserveHud: true,
            hudApi: overlayHudApi,
            teardownOptions: { preserveHud: true },
            cancelTeardownOptions: { preserveHud: true },
            onComplete: async (result) => {
              if (!window.__editOverlayActive) {
                stopOverlayLoop();
                return;
              }
              const latlngs = result && Array.isArray(result.latlngs) ? result.latlngs : [];
              const overlayGeoJSON = buildOverlayGeoJSONFromLatLngs(latlngs);
              const fullyCoversRefuge = latlngs.length >= 3 && overlayFullyContainsRefuge(latlngs, refuge.polygon);
              
              // Validate that the overlay overlaps with the refuge
              if (latlngs.length >= 3) {
                const overlaps = polygonsOverlap(latlngs, refuge.polygon);
                if (!overlaps) {
                  // Remove any preview layer that was created
                  const previewLayer = result && result.previewLayer;
                  if (previewLayer) {
                    try {
                      refugeLayerGroup.removeLayer(previewLayer);
                    } catch (e) {}
                  }
                  
                  // Show error and restart drawing loop without adding this polygon
                  if (statusEl) {
                    statusEl.style.display = '';
                    statusEl.innerHTML = 'Overlay must overlap with refuge';
                    statusEl.classList.remove('status-info', 'status-error', 'status-success');
                    statusEl.classList.add('status-error');
                    setTimeout(() => {
                      showSelectionStatus();
                    }, 2000);
                  }
                  if (window.__editing && window.__editOverlayActive) {
                    setTimeout(run, 0);
                  } else {
                    stopOverlayLoop();
                  }
                  return;
                }
              }
              
              let overlayLayer = result && result.previewLayer;
              if (!overlayLayer && latlngs.length >= 3) {
                try {
                  overlayLayer = L.polygon(latlngs, {
                    color: '#ff9800',
                    weight: 2,
                    fillColor: '#ff9800',
                    fillOpacity: 0.2
                  }).addTo(refugeLayerGroup);
                } catch (e) {
                  overlayLayer = null;
                }
              }
              if (overlayLayer && typeof overlayLayer.setStyle === 'function') {
                try {
                  overlayLayer.setStyle({ color: '#ff9800', weight: 2, fillColor: '#ff9800', fillOpacity: 0.2 });
                } catch (e) {}
              }

              if (overlayLayer && fullyCoversRefuge) {
                overlayLayer._subtractLocked = true;
              }

              if (overlayGeoJSON && !fullyCoversRefuge) {
                const validationResult = await validateOverlayDoesNotFragment(overlayGeoJSON);
                if (!validationResult.ok) {
                  if (overlayLayer) {
                    try {
                      refugeLayerGroup.removeLayer(overlayLayer);
                    } catch (e) {}
                  }
                  const message = validationResult.message || 'Overlay would fragment the refuge';
                  if (hudApi && typeof hudApi.setStatus === 'function') {
                    hudApi.setStatus(message, 'error');
                  }
                  if (statusEl) {
                    statusEl.style.display = '';
                    statusEl.innerHTML = message;
                    statusEl.classList.remove('status-info', 'status-error', 'status-success');
                    statusEl.classList.add('status-error');
                    setTimeout(() => {
                      showSelectionStatus();
                    }, 2500);
                  }
                  if (window.__editing && window.__editOverlayActive) {
                    setTimeout(run, 0);
                  } else {
                    stopOverlayLoop();
                  }
                  return;
                }
              }

              if (overlayLayer) {
                registerOverlayLayer(overlayLayer);
              }
              if (!Array.isArray(window.__editOverlayLayers)) window.__editOverlayLayers = [];
              if (overlayLayer) {
                overlayLayer._isEditOverlay = true;
                window.__editOverlayLayers.push(overlayLayer);
              }
              reorderOverlayRenderOrder();
              updateOverlayContainmentLocks();
              updateOperationButtonsState();
              overlayDrawingUndoState.enabled = false;
              overlayDrawingUndoState.handler = null;
              // Update undo button state after adding overlay
              if (typeof updateUndoButtonState === 'function') {
                updateUndoButtonState();
              }
              if (!Array.isArray(window.__editOverlayCache)) window.__editOverlayCache = [];
              if (latlngs && latlngs.length) {
                const storedCoords = latlngs.map(ll => ({ lat: ll.lat, lng: ll.lng }));
                if (storedCoords.length >= 3) {
                  const first = storedCoords[0];
                  const last = storedCoords[storedCoords.length - 1];
                  if (first.lat !== last.lat || first.lng !== last.lng) {
                    storedCoords.push({ lat: first.lat, lng: first.lng });
                  }
                }
                window.__editOverlayCache.push(storedCoords);
              }
              if (window.__editing && window.__editOverlayActive) {
                setTimeout(run, 500);
              } else {
                stopOverlayLoop();
              }
            }
          });
        };
        run();
      };
      // Auto-start overlay loop immediately on entering edit mode
      startOverlayLoop();
    }
    if (actions && !hud.querySelector('.hud-delete')) {
      // Clear existing content and create structure
      actions.innerHTML = '';
      
      // Create operation buttons row (Adjoin and Subtract)
      const operationRow = document.createElement('div');
      operationRow.className = 'hud-operations';
      
      adjoinBtn = document.createElement('button');
      adjoinBtn.className = 'hud-operation-btn hud-adjoin';
      adjoinBtn.type = 'button';
      adjoinBtn.textContent = 'Adjoin';
      operationRow.appendChild(adjoinBtn);
      
      subtractBtn = document.createElement('button');
      subtractBtn.className = 'hud-operation-btn hud-subtract';
      subtractBtn.type = 'button';
      subtractBtn.textContent = 'Subtract';
      operationRow.appendChild(subtractBtn);
      
      actions.appendChild(operationRow);
      
      // Create main action row (Delete, Undo, Save)
      const mainActionsRow = document.createElement('div');
      mainActionsRow.className = 'hud-actions-row';
      
      const leftContainer = document.createElement('div');
      leftContainer.className = 'hud-actions-left';
      const rightContainer = document.createElement('div');
      rightContainer.className = 'hud-actions-right';
      
      // Create delete button for left side
      const del = document.createElement('button');
      del.className = 'hud-delete';
      del.type = 'button';
      del.textContent = 'Delete';
      leftContainer.appendChild(del);
      
      // Create undo button for right side
      const undoBtn = document.createElement('button');
      undoBtn.className = 'hud-undo';
      undoBtn.type = 'button';
      undoBtn.textContent = 'Undo';
      undoBtn.disabled = true; // Initially disabled until an overlay is drawn
      rightContainer.appendChild(undoBtn);
      
      // Create save button for right side
      saveBtn = document.createElement('button');
      saveBtn.className = 'hud-save';
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save';
      rightContainer.appendChild(saveBtn);
      
      // Append containers to main actions row
      mainActionsRow.appendChild(leftContainer);
      mainActionsRow.appendChild(rightContainer);
      
      actions.appendChild(mainActionsRow);
      updateSelectionButtons();
      updateOperationButtonsState();
      
      const undoSelectionInMode = (mode) => {
        if (!mode) return false;
        const activeSet = mode === 'adjoin' ? overlaySelectionState.adjoin : overlaySelectionState.subtract;
        const history = selectionHistory[mode] || [];
        if (!activeSet || activeSet.size === 0 || history.length === 0) return false;
        while (history.length) {
          const layer = history.pop();
          if (layer && activeSet.has(layer)) {
            activeSet.delete(layer);
            layer._selectionRole = null;
            applyOverlayStyle(layer);
            const message = mode === 'adjoin'
              ? 'Removed last adjoin selection.'
              : 'Removed last subtract selection.';
            showSelectionStatus(message);
            return true;
          }
        }
        return false;
      };

      const showOverlayRemovedStatus = () => {
        // Helper prompts removed; leave existing alert text unchanged.
      };

      const removeLastOverlay = () => {
        if (!Array.isArray(window.__editOverlayLayers) || window.__editOverlayLayers.length === 0) return false;
        const lastOverlay = window.__editOverlayLayers.pop();
        if (!lastOverlay) return false;
        try {
          refugeLayerGroup.removeLayer(lastOverlay);
        } catch (e) {}
        overlaySelectionState.adjoin.delete(lastOverlay);
        overlaySelectionState.subtract.delete(lastOverlay);
        pruneSelectionHistoryForLayer(lastOverlay);
        updateOperationButtonsState();
        if (Array.isArray(window.__editOverlayCache) && window.__editOverlayCache.length > 0) {
          window.__editOverlayCache.pop();
        }
        updateOverlayContainmentLocks();
        showOverlayRemovedStatus();
        reorderOverlayRenderOrder();
        return true;
      };

      updateUndoButtonState = () => {
        if (!undoBtn) return;
        const activeMode = overlaySelectionState.mode;
        const hasSelectionUndo = !!activeMode
          && overlaySelectionState[activeMode]
          && overlaySelectionState[activeMode].size > 0;
        const hasDrawingUndo = overlayDrawingUndoState.enabled;
        const hasOverlayUndo = !activeMode
          && Array.isArray(window.__editOverlayLayers)
          && window.__editOverlayLayers.length > 0;
        undoBtn.disabled = !(hasSelectionUndo || hasDrawingUndo || hasOverlayUndo);
      };
      
      // Initialize undo button state
      updateUndoButtonState();
      
      // Undo button handler
      undoBtn.addEventListener('click', () => {
        const activeMode = overlaySelectionState.mode;
        if (activeMode && undoSelectionInMode(activeMode)) {
          updateUndoButtonState();
          return;
        }
        if (overlayDrawingUndoState.enabled && typeof overlayDrawingUndoState.handler === 'function') {
          overlayDrawingUndoState.handler();
          setTimeout(() => updateUndoButtonState(), 0);
          return;
        }
        if (removeLastOverlay()) {
          updateUndoButtonState();
        }
      });
      
      // Helper function to convert overlays to GeoJSON geometries
      const getOverlayGeometries = (layersOverride) => {
        const geometries = [];
        let sourceLayers;
        if (layersOverride instanceof Set) {
          sourceLayers = Array.from(layersOverride);
        } else if (Array.isArray(layersOverride)) {
          sourceLayers = layersOverride;
        } else {
          sourceLayers = Array.isArray(window.__editOverlayLayers) ? window.__editOverlayLayers : [];
        }
        sourceLayers.forEach(layer => {
          if (!layer || !layer.getLatLngs || !layer._map) return;
          try {
            const latlngs = layer.getLatLngs();
            const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
            // Convert to GeoJSON format [lng, lat]
            const ring = coords.map(ll => [ll.lng, ll.lat]);
            // Ensure closed ring
            if (ring.length >= 3) {
              const first = ring[0];
              const last = ring[ring.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) {
                ring.push(first);
              }
              geometries.push({
                type: 'Polygon',
                coordinates: [ring]
              });
            }
          } catch (e) {
            console.warn('Failed to convert overlay:', e);
          }
        });
        return geometries;
      };

      // Add adjoin functionality (selection mode with toggle)
      adjoinBtn.addEventListener('click', () => {
        const wasActive = overlaySelectionState.mode === 'adjoin';
        const activeMode = setSelectionMode('adjoin'); // This calls updateSelectionButtons() internally and pauses/resumes drawing
        resetOverlayButton();
        updateUndoButtonState(); // Update undo button when mode changes

        if (!activeMode && wasActive) {
          // Ensure overlay styles remain visible for selected overlays
          updateAllOverlayStyles();
        }
      });

      // Add subtract functionality (selection mode with toggle)
      subtractBtn.addEventListener('click', () => {
        const wasActive = overlaySelectionState.mode === 'subtract';
        const activeMode = setSelectionMode('subtract'); // This calls updateSelectionButtons() internally and pauses/resumes drawing
        resetOverlayButton();
        updateUndoButtonState(); // Update undo button when mode changes

        if (!activeMode && wasActive) {
          // Ensure overlay styles remain visible for selected overlays
          updateAllOverlayStyles();
        }
      });

      // Add save functionality (apply currently selected overlays)
      saveBtn.addEventListener('click', async () => {
        try {
          const adjoinGeoms = getOverlayGeometries(overlaySelectionState.adjoin);
          const subtractGeoms = getOverlayGeometries(overlaySelectionState.subtract);
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus('Saving…', 'info');
          
          const res = await fetch(`${window.BACKEND_BASE_URL}/api/refuges/${refuge.id}/apply-overlays`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adjoin: adjoinGeoms,
              subtract: subtractGeoms
            })
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data || data.status !== 'success') {
            const msg = (data && data.message) || `Failed to save (${res.status})`;
            throw new Error(msg);
          }

          refuge.polygon = data.refuge.polygon;
          cleanupEditOverlays();
          clearSelectionState();
          
          await loadAndRenderRefuges();
          
          hudApi.setStatus && hudApi.setStatus('Changes saved.', 'success');
          
          setTimeout(() => {
            const h = document.querySelector('.drawing-hud');
            h && h.remove();
            endEditing();
            openRefugeEditor(data.refuge);
          }, 800);
        } catch (e) {
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus((e && e.message) || 'Save failed', 'error');
        }
      });

      // Add delete functionality
      del.addEventListener('click', async () => {
        // Hide all buttons and operation row while processing to prevent repeat clicks
        try { operationRow.style.display = 'none'; } catch (e) {}
        try { mainActionsRow.style.display = 'none'; } catch (e) {}
        try {
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus('Deleting…', 'info');
          const deleted = await deleteRefugeById(refuge.id);
          lastDeletedRefuge = deleted;
          await loadAndRenderRefuges();
          const h = document.querySelector('.drawing-hud');
          h && h.remove();
          endEditing();
          const deletedName = (deleted && typeof deleted.name === 'string' && deleted.name.trim()) ? deleted.name : 'Refuge';
          showUndoToast(`${deletedName} deleted`, async () => {
            if (lastDeletedRefuge) {
              try { await recreateRefuge(lastDeletedRefuge); } finally { lastDeletedRefuge = null; }
              await loadAndRenderRefuges();
            }
          }, 12000);
        } catch (e) {
          if (statusEl) statusEl.style.display = '';
          hudApi.setStatus && hudApi.setStatus((e && e.message) || 'Delete failed', 'error');
          // Restore all buttons if deletion fails
          try { operationRow.style.display = ''; } catch (err) {}
          try { mainActionsRow.style.display = ''; } catch (err) {}
        }
      });
    }
    // No rename in edit mode; Delete remains the only persistent action
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
                  fillOpacity: 0,
                  interactive: true
                });
                polygon._refuge = { id: r.id, name: r.name, polygon: r.polygon };
                polygon._isRefugePolygon = true;
                const popupId = `ref-edit-${r.id}`;
                const renameId = `ref-rename-${r.id}`;
                const nameId = `ref-name-${r.id}`;
                const popupHtml = `
                  <div class="refuge-popup">
                    <div class="refuge-name-row">
                      <span id="${nameId}" class="refuge-name">${escapeHtml(r.name || 'Refuge')}</span>
                      <button id="${renameId}" class="refuge-rename-btn" type="button" title="Rename">Rename</button>
                    </div>
                    <button id="${popupId}" class="refuge-edit-link" type="button">Edit</button>
                  </div>
                `;
                polygon.addTo(refugeLayerGroup).bindPopup(popupHtml);

                // Gate popup opening so double-click zooms do not count as a single click
                const REFUGE_DOUBLE_CLICK_MS = 320;
                let refugeClickTimer = null;
                let refugeLastClickAt = 0;

                const handleRefugeClick = (e) => {
                  // Ignore refuge interactions until the first zoom-in is done
                  if (!hasCompletedFirstZoom) {
                    return;
                  }

                  // Block popups from opening while in edit mode or drawing mode
                  if (window.__editing || drawing) {
                    try { polygon.closePopup(); } catch (err) {}
                    // In edit mode, prevent the click from propagating
                    if (window.__editing) {
                      if (e && e.originalEvent && typeof e.originalEvent.preventDefault === 'function') {
                        e.originalEvent.preventDefault();
                      }
                    }
                    // In drawing mode, let the click propagate to the map for vertex addition
                    return;
                  }

                  const now = Date.now();
                  const sinceLast = now - refugeLastClickAt;
                  refugeLastClickAt = now;

                  if (refugeClickTimer) {
                    clearTimeout(refugeClickTimer);
                    refugeClickTimer = null;
                  }

                  if (sinceLast < REFUGE_DOUBLE_CLICK_MS) {
                    // Treat as double-click: suppress popup so map zoom can proceed
                    try { map.closePopup(); } catch (err) {}
                    return;
                  }

                  refugeClickTimer = setTimeout(() => {
                    refugeClickTimer = null;
                    if (!hasCompletedFirstZoom) return;
                    if (window.__editing || drawing) return;
                    try { polygon.openPopup(e.latlng); } catch (err) {}
                  }, REFUGE_DOUBLE_CLICK_MS + 20);
                };

                // Replace Leaflet's default click-to-open handler so we can apply timing
                polygon.off('click');
                polygon.on('click', handleRefugeClick);

                polygon.on('popupopen', () => {
                  // Block refuge popups until the initial zoom completes
                  if (!hasCompletedFirstZoom) {
                    polygon.closePopup();
                    return;
                  }
                  // Close popup immediately if editing mode or drawing mode is active
                  if (window.__editing || drawing) {
                    polygon.closePopup();
                    return;
                  }
                  const editBtn = document.getElementById(popupId);
                  const renameBtn = document.getElementById(renameId);
                  const nameEl = document.getElementById(nameId);
                  
                  // Allow tapping the name to zoom to the refuge bounds
                  if (nameEl) {
                    nameEl.style.cursor = 'pointer';
                    nameEl.title = 'Zoom to refuge';
                    nameEl.onclick = (ev) => {
                      ev && ev.stopPropagation && ev.stopPropagation();
                      if (!hasCompletedFirstZoom) return;
                      try {
                        const bounds = (typeof polygon.getBounds === 'function') ? polygon.getBounds() : null;
                        if (bounds && bounds.isValid && bounds.isValid()) {
                          map.fitBounds(bounds, { padding: [24, 24], maxZoom: Math.max(map.getZoom() || COUNTRY_ZOOM, 13) });
                        } else if (bounds && typeof bounds.getCenter === 'function') {
                          map.flyTo(bounds.getCenter(), Math.max(map.getZoom() || COUNTRY_ZOOM, 13));
                        }
                      } catch (err) {}
                    };
                  }
                  
                  if (editBtn) {
                    editBtn.onclick = (ev) => {
                      ev && ev.stopPropagation && ev.stopPropagation();
                      try { polygon.closePopup(); } catch (e) {}
                      openRefugeEditor(polygon._refuge);
                    };
                  }
                  
                  if (renameBtn && nameEl) {
                    let isEditing = false;
                    let originalName = r.name || 'Refuge';
                    
                    renameBtn.onclick = async (ev) => {
                      ev && ev.stopPropagation && ev.stopPropagation();
                      
                      if (!isEditing) {
                        // Switch to edit mode
                        isEditing = true;
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'refuge-name-input';
                        input.value = originalName;
                        // Size input to content length and keep it updated
                        try { input.size = Math.max(1, (originalName || '').length + 1); } catch (e) {}
                        nameEl.parentNode.replaceChild(input, nameEl);
                        input.focus();
                        input.select();
                        renameBtn.textContent = 'Save';
                        renameBtn.title = 'Save name';
                        input.addEventListener('input', () => {
                          try { input.size = Math.max(1, (input.value || '').length + 1); } catch (e) {}
                        });
                        
                        // Allow Enter key to save
                        input.onkeydown = (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            renameBtn.click();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            // Restore original name and cancel
                            input.parentNode.replaceChild(nameEl, input);
                            isEditing = false;
                            renameBtn.textContent = 'Rename';
                            renameBtn.title = 'Rename';
                          }
                        };
                      } else {
                        // Save mode
                        const input = (renameBtn.closest('.refuge-popup') || document).querySelector('.refuge-name-input');
                        if (!input) return;
                        
                        const newName = input.value.trim();
                        if (!newName) {
                          alert('Name cannot be empty');
                          return;
                        }
                        
                        try {
                          renameBtn.disabled = true;
                          renameBtn.textContent = 'Saving...';
                          await updateRefugeName(r.id, newName);
                          
                          // Update the stored name and UI
                          originalName = newName;
                          r.name = newName;
                          polygon._refuge.name = newName;
                          nameEl.textContent = newName;
                          
                          // Restore view mode
                          input.parentNode.replaceChild(nameEl, input);
                          isEditing = false;
                          renameBtn.textContent = 'Rename';
                          renameBtn.title = 'Rename';
                          renameBtn.disabled = false;
                          
                          // Don't close popup - keep it open
                        } catch (e) {
                          alert('Failed to save name: ' + (e.message || 'Unknown error'));
                          renameBtn.textContent = 'Save';
                          renameBtn.disabled = false;
                        }
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
      if (!hasCompletedFirstZoom) {
        try { setRefugePolygonsInteractive(false); } catch (e) {}
      }
    } catch (e) {
      console.warn('Failed to load refuges', e);
    }
  }
  // Helper: toggle interactivity for refuge polygons (and edit overlays while drawing)
  function setRefugePolygonsInteractive(interactive) {
    refugeLayerGroup.eachLayer(layer => {
      const isRefugeOrOverlay = !!(layer._isRefugePolygon || layer._isEditOverlay);
      if (isRefugeOrOverlay) {
        try {
          // Let Leaflet know this layer should or shouldn't receive events
          if (layer.options) {
            layer.options.interactive = interactive;
          }
          // Pointer events on the SVG/DOM element actually control click/touch hit-testing
          const el = layer._path || (typeof layer.getElement === 'function' && layer.getElement());
          if (el && el.style) {
            el.style.pointerEvents = interactive ? '' : 'none';
          }
        } catch (e) {}
      }
    });
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
      // Dispatch a custom event in case the host app wants to consume it (no zoom on mobile)
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
        // Also allow layer button during edit mode
        if ((typeof drawing !== 'undefined' && drawing && buttonId !== 'btn-layer') || (window.__editing && buttonId !== 'btn-layer')) {
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
      // Also allow layer button during edit mode
      if ((typeof drawing !== 'undefined' && drawing && buttonId !== 'btn-layer') || (window.__editing && buttonId !== 'btn-layer')) {
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

  // Center button: on mobile, snap map center (selector) to device GPS
  const centerBtn = document.getElementById('btn-center');
  if (centerBtn) {
    // Hide center button entirely on desktop; only show on phone-style UIs
    if (!isMobile) {
      centerBtn.style.display = 'none';
    } else {
      centerBtn.addEventListener('click', function (e) {
        e.stopPropagation();
      // Do not interfere while drawing or editing
      if ((typeof drawing !== 'undefined' && drawing) || window.__editing) return;
      if (!navigator.geolocation) {
        console.warn('Geolocation not available');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          try {
            if (!pos || !pos.coords) return;
            const lat = typeof pos.coords.latitude === 'number' ? pos.coords.latitude : null;
            const lng = typeof pos.coords.longitude === 'number' ? pos.coords.longitude : null;
            if (lat == null || lng == null) return;
            const target = L.latLng(lat, lng);
            // For phone versions, just move the map under the center cursor — no style changes
            map.setView(target, map.getZoom() || COUNTRY_ZOOM);
          } catch (err) {
            console.warn('Failed to center on GPS position', err);
          }
        },
        (err) => {
          console.warn('Geolocation error', err);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 10000
        }
      );
      });
    }
  }

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

  // Location search: search by place name or "lat,lng" and move map
  (function setupLocationSearch() {
    const input = document.getElementById('location-search-input');
    const button = document.getElementById('location-search-btn');
    if (!input || !button) return;

    const parseLatLng = (text) => {
      if (!text) return null;
      const cleaned = text.trim();
      // Match "lat,lng" or "lat lng"
      const m = cleaned.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (!m) return null;
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { lat, lng };
    };

    const performSearch = async () => {
      const query = (input.value || '').trim();
      if (!query) return;
      // Block while drawing or editing
      if ((typeof drawing !== 'undefined' && drawing) || window.__editing) return;

      // 1) Try coordinates first
      const coords = parseLatLng(query);
      if (coords) {
        map.setView([coords.lat, coords.lng], Math.max(map.getZoom() || COUNTRY_ZOOM, 10));
        try { closeSidePanel && closeSidePanel(); } catch (e) {}
        return;
      }

      // 2) Fallback to name search via Nominatim
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
          + encodeURIComponent(query);
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json'
          }
        });
        const results = await res.json().catch(() => []);
        if (Array.isArray(results) && results.length > 0) {
          const best = results[0];
          const lat = parseFloat(best.lat);
          const lng = parseFloat(best.lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            map.setView([lat, lng], Math.max(map.getZoom() || COUNTRY_ZOOM, 10));
            try { closeSidePanel && closeSidePanel(); } catch (e) {}
          }
        } else {
          alert('No results found for that search.');
        }
      } catch (err) {
        console.warn('Location search failed', err);
        alert('Search failed. Please try again.');
      }
    };

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      performSearch();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch();
      }
    });
  })();

  // -----------------------------
  // Refuge drawing logic
  // -----------------------------
  let drawing = null; // state holder when active

  // Desktop: align double-click zoom amount with mobile (2-level jump)
  if (!isMobile) {
    try {
      if (map.doubleClickZoom && typeof map.doubleClickZoom.disable === 'function') {
        map.doubleClickZoom.disable();
      }
    } catch (e) {}
    map.on('dblclick', (ev) => {
      // Skip zooming while drawing polygons so double-click can close shapes
      if (drawing) return;
      const centerTarget = (ev && ev.latlng) ? ev.latlng : map.getCenter();
      const currentZoom = map.getZoom();
      let maxZoom = typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : null;
      if (!Number.isFinite(maxZoom) || maxZoom === null) {
        maxZoom = 19;
      }
      const nextZoom = Math.min(maxZoom, currentZoom + DOUBLE_TAP_ZOOM_INCREMENT);
      if (nextZoom <= currentZoom) return;
      try {
        map.flyTo(centerTarget, nextZoom, { duration: 0.45, easeLinearity: 0.45 });
      } catch (err) {
        map.setView(centerTarget, nextZoom);
      }
    });
  }

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
      <div class="hud-drawing-undo-row">
        <button class="hud-undo" type="button" aria-label="Undo last point" disabled>Undo</button>
      </div>
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
    const undoRowEl = hud.querySelector('.hud-drawing-undo-row');
    const undoBtnEl = hud.querySelector('.hud-undo');
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
    const setUndoEnabled = (enabled) => {
      if (!undoBtnEl) return;
      undoBtnEl.disabled = !enabled;
    };
    const hideUndoRow = () => {
      if (!undoRowEl) return;
      undoRowEl.style.display = 'none';
    };
    const showUndoRow = () => {
      if (!undoRowEl) return;
      undoRowEl.style.display = '';
    };
    const setUndoHandler = (cb) => {
      if (!undoBtnEl) return;
      undoBtnEl.onclick = (ev) => {
        ev && ev.preventDefault && ev.preventDefault();
        ev && ev.stopPropagation && ev.stopPropagation();
        if (undoBtnEl.disabled) return;
        cb && cb();
      };
    };
    return {
      hud,
      setStatus,
      getName,
      focusName,
      onNameEnter,
      onOkClick,
      showNameBar,
      hideNameBar,
      hideOk,
      showOk,
      setUndoEnabled,
      hideUndoRow,
      showUndoRow,
      setUndoHandler
    };
  }

  function teardownDrawing(options = {}) {
    if (!drawing) return;
    const opts = options || {};
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
    if (opts.removePreview && drawing.closedPreview) {
      try { refugeLayerGroup.removeLayer(drawing.closedPreview); } catch (e) {}
    }
    const hud = document.querySelector('.drawing-hud');
    if (hud && !opts.preserveHud) hud.remove();
    const dot = document.querySelector('.map-center-dot');
    if (dot) dot.classList.remove('near-first');
    // Re-enable bottom UI interactions
    if (!opts.keepDrawingActiveClass) {
      try { document.body.classList.remove('drawing-active'); } catch (e) {}
    }
    // Restore refuge polygon interactivity
    try { setRefugePolygonsInteractive(true); } catch (e) {}
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
      return { ok: false, reason: 'too_few_points' };
    }
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    }
    if (!name || !name.trim()) {
      setStatus && setStatus('Enter a name in the bar to save.', 'info');
      return { ok: false, reason: 'missing_name' };
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
        return { ok: true };
      }
      const serverMsg = (data && data.message) || '';
      const isDuplicate = res.status === 409 || /already exists/i.test(serverMsg);
      if (isDuplicate) {
        setStatus && setStatus('That name is already in use. Enter a different name in the bar.', 'error');
        return { ok: false, reason: 'duplicate', message: serverMsg };
      }
      const isFullOverlap = /overlaps existing areas completely/i.test(serverMsg) || /nothing to save/i.test(serverMsg);
      if (isFullOverlap) {
        const overlapMsg = serverMsg || 'Refuge overlaps existing areas completely; nothing to save';
        setStatus && setStatus(overlapMsg, 'error');
        return { ok: false, reason: 'full_overlap', message: overlapMsg };
      }
      const msg = serverMsg || `Failed to save refuge (${res.status})`;
      setStatus && setStatus(msg, 'error');
      return { ok: false, reason: 'server', message: msg };
    } catch (e) {
      setStatus && setStatus('Error saving refuge.', 'error');
      return { ok: false, reason: 'exception', message: (e && e.message) || '' };
    }
  }

  function startRefugeDrawing(options = {}) {
    const opts = options || {};
    const skipSaving = !!opts.skipSaving;
    const teardownBeforeStart = Object.prototype.hasOwnProperty.call(opts, 'teardownBeforeStartOptions')
      ? opts.teardownBeforeStartOptions
      : (opts.preserveHud ? { preserveHud: true, keepDrawingActiveClass: !!opts.keepDrawingActiveClass } : undefined);
    if (drawing) teardownDrawing(teardownBeforeStart);
    // Disable bottom UI interactions while drawing
    try {
      document.body.classList.add('drawing-active');
      // Close any open option panels and side panel to avoid overlaying the map
      try { document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show')); } catch (e) {}
      try { typeof closeSidePanel === 'function' && closeSidePanel(); } catch (e) {}
      // Close any open map popups (refuge name popups)
      try { map && map.closePopup && map.closePopup(); } catch (e) {}
      // Make refuge polygons non-interactive so clicks pass through to the map
      try { setRefugePolygonsInteractive(false); } catch (e) {}
    } catch (e) {}
    const teardownOnCancel = Object.assign({}, opts.cancelTeardownOptions || {});
    teardownOnCancel.removePreview = true;
    const baseHudApi = opts.hudApi || createDrawingHud(() => {
      teardownDrawing(teardownOnCancel);
      if (typeof opts.onCancel === 'function') {
        try { opts.onCancel(); } catch (err) {}
      }
    });
    const hudApi = Object.assign({
      setStatus: () => {},
      getName: () => '',
      focusName: () => {},
      showNameBar: () => {},
      hideNameBar: () => {},
      hideOk: () => {},
      showOk: () => {},
      onNameEnter: null,
      onOkClick: null,
      setUndoEnabled: () => {},
      hideUndoRow: () => {},
      showUndoRow: () => {},
      setUndoHandler: () => {}
    }, baseHudApi || {});

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
    // Initially keep undo disabled and visible
    try { hudApi.setUndoEnabled(false); } catch (e) {}
    try { hudApi.showUndoRow(); } catch (e) {}
    const teardownAfterFinish = Object.prototype.hasOwnProperty.call(opts, 'teardownOptions')
      ? opts.teardownOptions
      : (opts.preserveHud ? { preserveHud: true } : undefined);
    // Dynamic announcement helpers (always use desktop text on all devices)
    const getMsgClickToAdd = () => 'click to add vertex';
    const getMsgDragToDraw = () => 'drag to draw line';
    const getMsgDoubleToClose = () => 'double click to close area';
    const showClickToAdd = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgClickToAdd(), 'info'); };
    const showDragToDraw = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgDragToDraw(), 'info'); };
    const showDoubleToClose = () => { if (state.helpersMuted) return; state.setStatus && state.setStatus(getMsgDoubleToClose(), 'info'); };
    // Show initial message on start
    showClickToAdd();
    const updateUndoButtonState = () => {
      try {
        hudApi.setUndoEnabled(state.vertices.length > 0 && !state.closedPreview);
      } catch (e) {}
    };
    const performUndo = () => {
      if (!state.vertices || state.vertices.length === 0 || state.closedPreview) return;
      // Remove last vertex
      state.vertices.pop();
      // Reset first marker
      if (state.firstMarker) {
        try { refugeLayerGroup.removeLayer(state.firstMarker); } catch (e) {}
        state.firstMarker = null;
      }
      if (state.vertices.length > 0) {
        setFirstMarker(state.vertices[0]);
      }
      // Update drawing aids
      if (state.vertices.length === 0) {
        try {
          state.polyline && state.polyline.setLatLngs([]);
          state.tempGuide && state.tempGuide.setLatLngs([]);
        } catch (e) {}
        showClickToAdd();
      } else {
        updatePolyline();
        showClickToAdd();
      }
      updateUndoButtonState();
    };
    try {
      hudApi.setUndoHandler(() => {
        performUndo();
      });
    } catch (e) {}
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
      if (skipSaving) {
        const latlngsClone = state.vertices.map(ll => L.latLng(ll.lat, ll.lng));
        let previewLayer = state.closedPreview;
        if (!previewLayer && latlngsClone.length >= 3) {
          try {
            previewLayer = L.polygon(latlngsClone, {
              color: '#1e90ff',
              weight: 2,
              fillColor: '#1e90ff',
              fillOpacity: 0.15
            }).addTo(refugeLayerGroup);
          } catch (e) {
            previewLayer = null;
          }
        }
        teardownDrawing(teardownAfterFinish);
        if (typeof opts.onComplete === 'function') {
          try {
            opts.onComplete({
              latlngs: latlngsClone,
              previewLayer
            });
          } catch (err) {}
        }
        return;
      }
      const name = hudApi.getName ? hudApi.getName() : '';
      if (!name) {
        hudApi.showNameBar && hudApi.showNameBar();
        state.setStatus && state.setStatus('Enter a name to save.', 'info');
        hudApi.focusName && hudApi.focusName();
        return;
      }
      hudApi.hideOk && hudApi.hideOk();
      const result = await saveRefugePolygon(state.vertices, name, state.setStatus);
      const ok = result === true || (result && result.ok === true);
      const fullOverlap = result && result.reason === 'full_overlap';
      if (ok) {
        teardownDrawing();
      } else if (fullOverlap) {
        // For complete-overlap errors, block inputs and clear the drawn refuge
        hudApi.hideNameBar && hudApi.hideNameBar();
        hudApi.hideOk && hudApi.hideOk();
        teardownDrawing({ preserveHud: true, removePreview: true });
      } else {
        hudApi.showOk && hudApi.showOk();
      }
    };

    if (!skipSaving) {
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
    }


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
        // Once polygon is closed, hide the undo button
        try { hudApi.hideUndoRow(); } catch (e) {}
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
        updateUndoButtonState();
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
        updateUndoButtonState();
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
          updateUndoButtonState();
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
