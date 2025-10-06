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
        alert('Refuge drawing. This feature will be implemented soon.');
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
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
}); 
