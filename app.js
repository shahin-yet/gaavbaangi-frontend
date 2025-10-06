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
      if (window.__suppressCenterDoubleAction) return;
      // If refuge drawing is active, defer to drawing's dblclick logic (no zoom)
      if (typeof refugeDrawingActive !== 'undefined' && refugeDrawingActive) {
        const center = map.getCenter();
        const pixel = map.latLngToContainerPoint(center);
        window.dispatchEvent(new CustomEvent('map-center-doubletap', {
          detail: { latlng: { lat: center.lat, lng: center.lng }, pixel }
        }));
        return;
      }
      // Default behavior: zoom in using map center
      map.zoomIn(1);
      const center = map.getCenter();
      const pixel = map.latLngToContainerPoint(center);
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
        // During refuge drawing, route double-tap to Leaflet dblclick so drawing logic runs
        if (typeof refugeDrawingActive !== 'undefined' && refugeDrawingActive) {
          window.__suppressCenterDoubleAction = true;
          map.fire('dblclick');
          setTimeout(() => { window.__suppressCenterDoubleAction = false; }, 250);
        } else {
          applyCenterDoubleAction();
        }
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
      text: 'Refuge Area',
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
 
  // ---------------------------
  // Refuge drawing interaction
  // ---------------------------
  let refugeDrawingActive = false;
  let refugeVertices = []; // Array of L.LatLng
  let refugePolyline = null; // L.Polyline during drawing
  let refugePolygonPreview = null; // Optional preview when closing
  let lastCenter = null;
  let firstVertexMarker = null; // clickable for dblclick-to-close

  function getMapCenterLatLng() {
    return map.getCenter();
  }

  function clearRefugeDrawing() {
    refugeVertices = [];
    if (refugePolyline) { map.removeLayer(refugePolyline); refugePolyline = null; }
    if (refugePolygonPreview) { map.removeLayer(refugePolygonPreview); refugePolygonPreview = null; }
    lastCenter = null;
    if (firstVertexMarker) { map.removeLayer(firstVertexMarker); firstVertexMarker = null; }
  }

  function startRefugeDrawing() {
    if (refugeDrawingActive) return;
    refugeDrawingActive = true;
    clearRefugeDrawing();

    // Styling
    const lineStyle = { color: '#ff9800', weight: 3, dashArray: '6,6' };
    const polygonStyle = { color: '#ff9800', weight: 2, fillColor: '#ff9800', fillOpacity: 0.2 };

    // Click (or tap) places a vertex at the map center
    const addVertexAtCenter = () => {
      const c = getMapCenterLatLng();
      refugeVertices.push([c.lat, c.lng]);
      if (refugePolyline) {
        refugePolyline.setLatLngs(refugeVertices);
      } else {
        refugePolyline = L.polyline(refugeVertices, lineStyle).addTo(map);
      }
      // Create/update first vertex marker for dblclick-to-close
      if (refugeVertices.length === 1) {
        if (firstVertexMarker) { map.removeLayer(firstVertexMarker); firstVertexMarker = null; }
        firstVertexMarker = L.circleMarker([c.lat, c.lng], { radius: 6, color: '#ff9800', weight: 2, fillColor: '#ffffff', fillOpacity: 1.0 });
        firstVertexMarker.addTo(map);
        firstVertexMarker.on('dblclick', function (ev) {
          ev.originalEvent && (ev.originalEvent.preventDefault && ev.originalEvent.preventDefault());
          ev.originalEvent && (ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation());
          window.__suppressCenterDoubleAction = true;
          finalizePolygon();
          setTimeout(() => { window.__suppressCenterDoubleAction = false; }, 250);
        });
        // Prevent map dblclick zoom when hitting marker
        firstVertexMarker.on('click', function (ev) {
          ev.originalEvent && (ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation());
        });
      }
    };

    // Map click handler to add vertex
    const onMapClick = (e) => {
      e && e.originalEvent && (e.originalEvent.preventDefault && e.originalEvent.preventDefault());
      addVertexAtCenter();
    };

    // As the user pans the map, draw a live segment from last vertex to current center
    const onMapMove = () => {
      if (!refugeDrawingActive || refugeVertices.length === 0) return;
      const c = getMapCenterLatLng();
      lastCenter = c;
      const live = refugeVertices.concat([[c.lat, c.lng]]);
      if (refugePolyline) {
        refugePolyline.setLatLngs(live);
      } else {
        refugePolyline = L.polyline(live, lineStyle).addTo(map);
      }
    };

    // Double click near first vertex closes the polygon (backup for center-dot/keyboard-only)
    const isNearFirstVertex = () => {
      if (refugeVertices.length < 3) return false;
      const first = refugeVertices[0];
      const c = getMapCenterLatLng();
      const distMeters = map.distance(L.latLng(first[0], first[1]), c);
      return distMeters < 25; // threshold in meters
    };

    const finalizePolygon = () => {
      if (refugeVertices.length < 3) return;
      const coords = refugeVertices.map(([lat, lng]) => [lng, lat]);
      // Close ring by repeating first vertex
      if (coords.length > 0) coords.push(coords[0]);
      const geojson = { type: 'Polygon', coordinates: [coords] };

      // Render final polygon
      const latlngs = refugeVertices.map(v => L.latLng(v[0], v[1]));
      if (refugePolyline) { map.removeLayer(refugePolyline); refugePolyline = null; }
      if (refugePolygonPreview) { map.removeLayer(refugePolygonPreview); }
      refugePolygonPreview = L.polygon(latlngs, polygonStyle).addTo(map);

      // Ask for a name
      const name = prompt('Enter a name for this refuge:') || undefined;

      // Persist to backend
      saveRefugePolygon(geojson, name).then(() => {
        stopRefugeDrawing();
        loadAndRenderRefuges();
      }).catch(err => {
        alert('Failed to save refuge: ' + (err && err.message ? err.message : err));
        stopRefugeDrawing();
      });
    };

    const onDoubleClick = (e) => {
      e && e.originalEvent && (e.originalEvent.preventDefault && e.originalEvent.preventDefault());
      if (isNearFirstVertex()) {
        finalizePolygon();
      } else {
        // Not near start: treat as adding a vertex and continue
        addVertexAtCenter();
      }
    };

    function stopRefugeDrawing() {
      refugeDrawingActive = false;
      map.off('click', onMapClick);
      map.off('move', onMapMove);
      map.off('dblclick', onDoubleClick);
      // Keep the final polygon on map; clear transient state
      refugeVertices = [];
      if (refugePolyline) { map.removeLayer(refugePolyline); refugePolyline = null; }
    }

    // Attach listeners
    map.on('click', onMapClick);
    map.on('move', onMapMove);
    map.on('dblclick', onDoubleClick);

    // If Telegram WebApp disabled doubleClickZoom already above, we keep it; otherwise disable during drawing
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
  }

  async function saveRefugePolygon(geojson, name) {
    const base = window.BACKEND_BASE_URL;
    const res = await fetch(`${base}/api/refuges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon: geojson, name })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Request failed');
    }
    return res.json();
  }

  async function loadAndRenderRefuges() {
    try {
      const base = window.BACKEND_BASE_URL;
      const res = await fetch(`${base}/api/refuges`);
      const data = await res.json();
      if (data && Array.isArray(data.refuges)) {
        data.refuges.forEach(r => {
          try {
            if (r && r.polygon && r.polygon.type === 'Polygon') {
              const ring = r.polygon.coordinates && r.polygon.coordinates[0];
              if (Array.isArray(ring)) {
                const latlngs = ring.map(([lng, lat]) => L.latLng(lat, lng));
                // Remove last duplicate if closed
                if (latlngs.length > 1) {
                  const first = latlngs[0];
                  const last = latlngs[latlngs.length - 1];
                  if (first.lat === last.lat && first.lng === last.lng) latlngs.pop();
                }
                L.polygon(latlngs, { color: '#4caf50', weight: 2, fillColor: '#4caf50', fillOpacity: 0.15 }).addTo(map);
              }
            }
          } catch (_) {}
        });
      }
    } catch (e) {
      // fail silently for now
    }
  }

  // Load existing refuges on startup
  loadAndRenderRefuges();
}); 
