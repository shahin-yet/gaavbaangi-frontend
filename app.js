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
  const isDesktop = !isMobile;
  
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
    // Add initial state class to show cursor before first zoom
    document.body.classList.add('before-first-zoom');
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
  let firstTapZoomDisabled = false;
  let firstTapZoomHandler = null;
  const detachFirstTapZoom = () => {
    if (firstTapZoomHandler) {
      try { map.off('click', firstTapZoomHandler); } catch (e) {}
      firstTapZoomHandler = null;
    }
  };
  const markFirstZoomComplete = () => {
    if (hasCompletedFirstZoom) return;
    hasCompletedFirstZoom = true;
    detachFirstTapZoom();
    // Remove the initial state class to hide cursor after first zoom
    document.body.classList.remove('before-first-zoom');
    try { setRefugePolygonsInteractive(true); } catch (e) {}
  };
  const disableFirstTapZoom = () => {
    if (firstTapZoomDisabled) return;
    firstTapZoomDisabled = true;
    markFirstZoomComplete();
  };
  // Guard: block all UI (except menu + map pan/zoom) until the first zoom-in tap.
  const shouldBlockInitialUi = () => !hasCompletedFirstZoom;
  const isAllowedDuringInitialGuard = (target) => {
    if (!target) return false;
    // Keep map interactions and Leaflet controls usable
    if (target.closest('#map')) return true;
    if (target.closest('.leaflet-control-zoom')) return true;
    // Menu button and related surfaces remain available
    if (target.closest('#fab-menu')) return true;
    if (target.closest('#side-panel')) return true;
    if (target.closest('#side-close')) return true;
    if (target.closest('#menu-overlay')) return true;
    // Allow center button so users can skip first-tap zoom via recentering
    if (target.closest('#btn-center')) return true;
    return false;
  };
  const initialGuardInterceptor = (ev) => {
    if (!shouldBlockInitialUi()) return;
    if (isAllowedDuringInitialGuard(ev.target)) return;
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    ev.stopPropagation();
    ev.preventDefault();
  };
  ['click', 'pointerdown', 'touchstart'].forEach((evtName) => {
    document.addEventListener(evtName, initialGuardInterceptor, true);
  });
  map.whenReady(() => {
    try {
      map.fitWorld({ animate: false });
      // fitWorld recalculates zoom, so re-apply configured world zoom afterwards
      map.setView(MAP_CENTER, WORLD_ZOOM, { animate: false });
      setTimeout(() => map.invalidateSize(), 0);
    } catch (e) {}
  });
  // First tap zoom-in: zoom to country level, then release the initial guard
  firstTapZoomHandler = (ev) => {
    if (hasCompletedFirstZoom) {
      detachFirstTapZoom();
      return;
    }
    if (isMobile && firstTapZoomDisabled) {
      detachFirstTapZoom();
      return;
    }
    const firstTapTarget = isMobile ? map.getCenter() : ev.latlng;
    try {
      map.flyTo(firstTapTarget, COUNTRY_ZOOM, { duration: 0.7, easeLinearity: 0.4 });
    } catch (err) {
      map.setView(firstTapTarget, COUNTRY_ZOOM);
    }
    // Release initial interaction guard after the first zoom attempt
    markFirstZoomComplete();
    detachFirstTapZoom();
  };
  map.on('click', firstTapZoomHandler);
  // If a user pinches or uses controls to zoom in before the first tap zoom,
  // unlock the UI once they go past the initial world zoom level.
  map.on('zoomend', () => {
    if (hasCompletedFirstZoom) return;
    const currentZoom = (typeof map.getZoom === 'function') ? map.getZoom() : null;
    if (currentZoom == null) return;
    if (currentZoom > WORLD_ZOOM + 0.01) {
      markFirstZoomComplete();
    }
  });

  // Track if a refuge polygon was clicked to distinguish from map background clicks
  let refugeClickedFlag = false;

  // Map click handler for deselecting refuge when clicking outside any refuge
  map.on('click', (ev) => {
    // Deselect on background taps only in admin map mode
    if (isUserMapMode) return;
    // Wait for first zoom to complete before enabling deselect behavior
    if (!hasCompletedFirstZoom) return;
    // Skip if a refuge was just clicked (flag set by polygon click handler)
    if (refugeClickedFlag) {
      refugeClickedFlag = false;
      return;
    }
    // Skip during drawing, editing, or path config modes
    if ((typeof drawing !== 'undefined' && drawing) || window.__editing || isPathConfigOpen()) return;
    // Always clear any transient name popups on background taps
    closeMobileRefugeNamePopup();
    // Check if there's a selected refuge to clear
    if (selectedRefuge) {
      setSelectedRefuge(null);
      // Zoom back to country level (5x)
      try {
        map.flyTo(map.getCenter(), COUNTRY_ZOOM, { duration: 0.5, easeLinearity: 0.4 });
      } catch (err) {
        map.setView(map.getCenter(), COUNTRY_ZOOM);
      }
    }
  });

  // Save map view state (center and zoom) when user moves or zooms the map
  map.on('moveend', () => {
    try {
      const currentState = isUserMapMode ? userMapState : adminMapState;
      currentState.mapCenter = map.getCenter();
      currentState.mapZoom = map.getZoom();
    } catch (e) {
      // Ignore errors
    }
  });

  // Load saved paths initially
  loadSavedPaths();
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
  const refugeListEl = document.getElementById('refuge-list');
  const refugeListEmptyEl = document.getElementById('refuge-list-empty');
  const refugeListCountEl = document.getElementById('refuge-list-count');
  const refugeSearchInput = document.getElementById('location-search-input');
  let refugesCache = [];
  let defaultRefugeId = null;
  let selectedRefuge = null;
  let adminSelectedRefugeId = null;
  let userSelectedRefugeId = null;
  let mobileRefugeNamePopup = null;
  // Track temporarily hidden refuge polygons on mobile when a single refuge is selected
  let mobileHiddenRefugeLayers = [];
  
  // Map state preservation for each map mode
  let adminMapState = {
    selectedRefugeId: null,
    searchQuery: '',
    mapCenter: null,
    mapZoom: null
  };
  let userMapState = {
    selectedRefugeId: null,
    searchQuery: '',
    mapCenter: null,
    mapZoom: null
  };

  function closeMobileRefugeNamePopup() {
    if (mobileRefugeNamePopup) {
      try { map.closePopup(mobileRefugeNamePopup); } catch (e) {}
      try { map.removeLayer(mobileRefugeNamePopup); } catch (e) {}
      mobileRefugeNamePopup = null;
    }
  }

  function openMobileRefugeNamePopup(refuge, anchorLatLng) {
    if (!isMobile) return;
    if (!anchorLatLng) return;
    if (!hasCompletedFirstZoom) return;
    if (isPathConfigOpen() || window.__editing || drawing) return;
    try {
      closeMobileRefugeNamePopup();
      mobileRefugeNamePopup = L.popup({
        closeButton: false,
        autoPan: false,
        closeOnClick: false,
        className: 'refuge-hover-popup',
        offset: [0, -6]
      })
        .setLatLng(anchorLatLng)
        .setContent(`<div class="refuge-hover-name">${escapeHtml((refuge && refuge.name) || 'Refuge')}</div>`);
      map.addLayer(mobileRefugeNamePopup);
    } catch (e) {}
  }

  const resolveLayerUrl = (layer) => {
    if (!layer || !layer.url) return '';
    if (!layer.apiKey) return layer.url;
    const apiKeyParam = layer.apiKeyParam || 'apikey';
    if (layer.url.includes('{apikey}')) {
      return layer.url.replace('{apikey}', encodeURIComponent(layer.apiKey));
    }
    const separator = layer.url.includes('?') ? '&' : '?';
    return `${layer.url}${separator}${encodeURIComponent(apiKeyParam)}=${encodeURIComponent(layer.apiKey)}`;
  };

  const configuredBaseLayers = (window.MAP_LAYER_CONFIG && Array.isArray(window.MAP_LAYER_CONFIG.baseLayers) && window.MAP_LAYER_CONFIG.baseLayers.length)
    ? window.MAP_LAYER_CONFIG.baseLayers
    : [
        {
          id: 'satellite',
          name: 'Satellite',
          icon: 'fas fa-satellite',
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          options: {
            maxZoom: 19,
            attribution: 'Tiles (c) Esri - Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          },
          default: true
        },
        {
          id: 'terrain',
          name: 'Terrain',
          icon: 'fas fa-mountain',
          url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
          options: {
            maxZoom: 17,
            attribution: 'Map data: (c) OpenTopoMap contributors'
          }
        }
      ];
  const validBaseLayers = configuredBaseLayers.filter((layer) => layer && layer.id && layer.url);
  const baseLayerInstances = {};
  validBaseLayers.forEach((layer) => {
    const resolvedUrl = resolveLayerUrl(layer);
    baseLayerInstances[layer.id] = L.tileLayer(resolvedUrl, layer.options || {});
  });
  const defaultBaseLayerId = (validBaseLayers.find((layer) => layer.default) || validBaseLayers[0] || {}).id;
  if (defaultBaseLayerId && baseLayerInstances[defaultBaseLayerId]) {
    baseLayerInstances[defaultBaseLayerId].addTo(map);
  }

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

  const normalizeRefugeName = (name) => (name || '').toString().trim().toLowerCase();

  function getRefugeBounds(refuge) {
    if (!refuge || !refuge.polygon) return null;
    if (refuge._bounds && refuge._bounds.isValid && refuge._bounds.isValid()) return refuge._bounds;
    try {
      const gj = L.geoJSON(refuge.polygon);
      const bounds = gj.getBounds();
      refuge._bounds = bounds;
      return bounds;
    } catch (e) {
      return null;
    }
  }

  function focusRefuge(refuge) {
    if (!refuge) return;
    setSelectedRefuge(refuge);
    if (isPathConfigOpen()) return;
    if ((typeof drawing !== 'undefined' && drawing) || window.__editing) return;
    const bounds = getRefugeBounds(refuge);
    // Standard refuge zoom level
    const STANDARD_REFUGE_ZOOM = 16;
    // In user map mode, always cap zoom to the standard level to avoid inheriting prior admin zoom
    const targetMaxZoom = isUserMapMode ? STANDARD_REFUGE_ZOOM : Math.max(map.getZoom() || COUNTRY_ZOOM, STANDARD_REFUGE_ZOOM);
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: targetMaxZoom });
    } else if (bounds && typeof bounds.getCenter === 'function') {
      map.flyTo(bounds.getCenter(), targetMaxZoom);
    }
    try { closeSidePanel && closeSidePanel(); } catch (e) {}
  }

  // Shared selection logic so map taps mirror list-row selection on mobile
  function selectRefugeLikeList(refuge) {
    // In user map mode, list rows should not trigger selection; only the default tick controls selection
    if (isUserMapMode) return;
    if (!refuge || refuge.id == null) return;
    const isAlreadySelected = selectedRefuge && selectedRefuge.id != null && selectedRefuge.id === refuge.id;
    if (isAlreadySelected) {
      setSelectedRefuge(null);
      try {
        map.flyTo(map.getCenter(), COUNTRY_ZOOM, { duration: 0.5, easeLinearity: 0.4 });
      } catch (err) {
        map.setView(map.getCenter(), COUNTRY_ZOOM);
      }
      return;
    }
    focusRefuge(refuge);
  }

  function renderRefugeList(refuges = [], query = '') {
    if (!refugeListEl) return;
    const searchTerm = normalizeRefugeName(query);
    refugeListEl.innerHTML = '';
    if (refugeListCountEl) refugeListCountEl.textContent = Array.isArray(refuges) ? refuges.length.toString() : '0';

    if (!Array.isArray(refuges) || !refuges.length) {
      if (refugeListEmptyEl) refugeListEmptyEl.style.display = 'block';
      return;
    }

    if (refugeListEmptyEl) refugeListEmptyEl.style.display = 'none';

    const safeRegex = searchTerm
      ? new RegExp(`(${searchTerm.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')})`, 'ig')
      : null;

    const sorted = [...refuges].sort((a, b) => {
      const aDefault = defaultRefugeId && a && a.id && defaultRefugeId === a.id;
      const bDefault = defaultRefugeId && b && b.id && defaultRefugeId === b.id;
      if (aDefault && !bDefault) return -1;
      if (bDefault && !aDefault) return 1;
      return normalizeRefugeName(a.name).localeCompare(normalizeRefugeName(b.name));
    });
    sorted.forEach((refuge) => {
      const item = document.createElement('div');
      item.className = 'refuge-list-item';
      item.dataset.refugeId = refuge && refuge.id != null ? String(refuge.id) : '';

      const name = refuge && refuge.name ? refuge.name : 'Unnamed refuge';
      const safeName = escapeHtml(name);
      const nameHtml = safeRegex ? safeName.replace(safeRegex, '<span class="refuge-list-highlight">$1</span>') : safeName;
      const isDefaultChecked = defaultRefugeId && refuge && refuge.id && defaultRefugeId === refuge.id;
      // Keep default styling consistent regardless of which map is active
      const showDefaultHighlight = !!isDefaultChecked;
      const defaultAttrs = [];
      if (isDefaultChecked) defaultAttrs.push('checked');
      if (showDefaultHighlight) {
        item.classList.add('is-default');
      }
      const defaultControlHtml = isUserMapMode
        ? `
          <label class="refuge-default">
            <input type="radio" name="refuge-default" ${defaultAttrs.join(' ')} aria-label="Set as default refuge" />
            <span class="refuge-default-indicator" aria-hidden="true"></span>
            <span class="sr-only">Set as default refuge</span>
          </label>
        `
        : (
          isDefaultChecked
            ? `
          <span class="refuge-default refuge-default-static" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle;">
              <circle cx="10" cy="10" r="9" fill="#4CAF50" stroke="#4CAF50" stroke-width="1"/>
              <path d="M6 10 L9 13 L14 7" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="sr-only">Default refuge</span>
        `
            : ''
        );

      item.innerHTML = `
        <span class="refuge-list-name">${nameHtml}</span>
        <div class="refuge-list-meta">
          <button type="button" class="refuge-membership-btn">membership</button>
          ${defaultControlHtml}
        </div>
      `;

      // Make item focusable for keyboard navigation
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'button');
      
      // Handle row activation (click or keyboard)
      const handleRowActivation = (fromClick = false) => {
        selectRefugeLikeList(refuge);
        // On mobile touch, blur the row immediately to prevent stuck focus styling
        if (fromClick && isMobile) {
          try { item.blur(); } catch (e) {}
        }
      };
      
      item.addEventListener('click', () => handleRowActivation(true));
      
      item.addEventListener('keydown', (ev) => {
        // Handle Enter and Space for keyboard activation (tabbing into row)
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          handleRowActivation();
        }
      });

      const membershipBtn = item.querySelector('.refuge-membership-btn');
      if (membershipBtn) {
        membershipBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // placeholder: membership button has no action
        });
      }

      const radio = item.querySelector('input[type="radio"]');
      const radioLabel = item.querySelector('label.refuge-default');
      
      // Stop propagation on label clicks so they don't trigger row click handler
      if (radioLabel) {
        radioLabel.addEventListener('click', (ev) => {
          ev.stopPropagation();
        });
      }
      
      if (radio) {
        // Handle click/keydown to toggle default refuge off when already checked
        const handleRadioActivation = (ev) => {
          ev.stopPropagation();
          const wasChecked = isDefaultChecked; // Was this refuge already the default?
          
          if (wasChecked) {
            // Already checked: toggle off
            ev.preventDefault();
            defaultRefugeId = null;
            setSelectedRefuge(null);
            // Zoom back to country level (5x) while keeping menu open
            try {
              map.flyTo(map.getCenter(), COUNTRY_ZOOM, { duration: 0.5, easeLinearity: 0.4 });
            } catch (err) {
              map.setView(map.getCenter(), COUNTRY_ZOOM);
            }
            // Re-render to update UI
            renderRefugeList(refuges, query);
          } else {
            // Not checked: set as default and select/focus (like user map behavior)
            if (refuge && refuge.id) {
              defaultRefugeId = refuge.id;
              setSelectedRefuge(refuge);
              focusRefuge(refuge);
            }
            // Re-render to ensure default styling stays in sync
            renderRefugeList(refuges, query);
          }
        };
        
        radio.addEventListener('click', (ev) => {
          handleRadioActivation(ev);
        });
        
        radio.addEventListener('keydown', (ev) => {
          // Handle Enter and Space for keyboard activation (tabbing into it)
          if (ev.key === 'Enter' || ev.key === ' ') {
            handleRadioActivation(ev);
          }
        });
      }

      refugeListEl.appendChild(item);
    });
    syncSelectedRefugeUi();
  }

  function applyRefugeSearchFilter() {
    const query = (refugeSearchInput && refugeSearchInput.value) ? refugeSearchInput.value.trim() : '';
    const filtered = query
      ? refugesCache.filter((r) => normalizeRefugeName(r.name).includes(normalizeRefugeName(query)))
      : refugesCache;
    renderRefugeList(filtered, query);
    return filtered;
  }

  function setSelectedRefuge(refuge) {
    const prevDefaultId = defaultRefugeId;
    const isValidRefuge = refuge && typeof refuge === 'object' && refuge.id != null;
    if (isValidRefuge) {
      selectedRefuge = refuge;
      // In user map mode, any selection should also set the default tick
      if (isUserMapMode) {
        defaultRefugeId = refuge.id;
        userSelectedRefugeId = refuge.id;
        userMapState.selectedRefugeId = refuge.id;
      } else {
        adminSelectedRefugeId = refuge.id;
        adminMapState.selectedRefugeId = refuge.id;
      }
    } else {
      selectedRefuge = null;
      if (isUserMapMode) {
        userSelectedRefugeId = null;
        userMapState.selectedRefugeId = null;
      } else {
        adminSelectedRefugeId = null;
        adminMapState.selectedRefugeId = null;
      }
    }
    if (isMobile) {
      closeMobileRefugeNamePopup();
    }
    const defaultChanged = defaultRefugeId !== prevDefaultId;
    syncSelectedRefugeUi();
    if (isUserMapMode && defaultChanged) {
      // Re-render to ensure radio state matches map selection
      applyRefugeSearchFilter();
    }
    updateMobileRefugeVisibility();
    updateMapZoomLimits();
  }

  // Save current map state before switching modes
  function saveCurrentMapState() {
    const currentState = isUserMapMode ? userMapState : adminMapState;
    
    // Save selected refuge
    if (selectedRefuge && selectedRefuge.id != null) {
      currentState.selectedRefugeId = selectedRefuge.id;
    } else {
      currentState.selectedRefugeId = null;
    }
    
    // Save search query
    if (refugeSearchInput && refugeSearchInput.value) {
      currentState.searchQuery = refugeSearchInput.value.trim();
    } else {
      currentState.searchQuery = '';
    }
    
    // Save map view (center and zoom)
    try {
      currentState.mapCenter = map.getCenter();
      currentState.mapZoom = map.getZoom();
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Restore the selection and state that belongs to the current map mode (admin/user)
  function restoreSelectionForCurrentMode() {
    const currentState = isUserMapMode ? userMapState : adminMapState;
    
    // Restore selected refuge
    const targetId = currentState.selectedRefugeId;
    if (targetId) {
      const refuge = refugesCache.find((r) => r && r.id === targetId);
      setSelectedRefuge(refuge || null);
      
      // In user map mode, zoom to the selected refuge with standard zoom level
      if (isUserMapMode && refuge) {
        // Use standard refuge zoom level to match admin map behavior
        setTimeout(() => {
          try {
            const bounds = getRefugeBounds(refuge);
            const STANDARD_REFUGE_ZOOM = 16;
            const targetMaxZoom = STANDARD_REFUGE_ZOOM;
            if (bounds && bounds.isValid && bounds.isValid()) {
              map.fitBounds(bounds, { padding: [24, 24], maxZoom: targetMaxZoom });
            } else if (bounds && typeof bounds.getCenter === 'function') {
              map.flyTo(bounds.getCenter(), targetMaxZoom);
            }
          } catch (e) {
            // Ignore errors
          }
        }, 100);
        return; // Skip restoring old map view in user map mode when refuge is selected
      }
    } else {
      setSelectedRefuge(null);
    }
    
    // Restore search query
    if (refugeSearchInput) {
      refugeSearchInput.value = currentState.searchQuery || '';
    }
    
    // Restore map view (with a slight delay to ensure rendering is complete)
    // Only restore saved view in admin map mode or when no refuge is selected in user map
    if (currentState.mapCenter && currentState.mapZoom != null) {
      setTimeout(() => {
        try {
          map.setView(currentState.mapCenter, currentState.mapZoom, { animate: false });
        } catch (e) {
          // Ignore errors
        }
      }, 100);
    } else if (!targetId) {
      // If no refuge is selected and no saved map view, default to country zoom (5x)
      setTimeout(() => {
        try {
          map.setView(map.getCenter(), COUNTRY_ZOOM, { animate: false });
        } catch (e) {
          // Ignore errors
        }
      }, 100);
    }
  }

  // Set minimum zoom limit based on selected refuge bounds in user map mode
  function updateMapZoomLimits() {
    // Only apply zoom limits in user map mode
    if (!isUserMapMode) {
      // Reset to no minimum zoom if not in user map mode
      try {
        map.setMinZoom(0);
        map.setMaxBounds(null);
      } catch (e) {}
      return;
    }

    // If a refuge is selected, calculate the zoom level that fits its bounds
    if (selectedRefuge && selectedRefuge.id != null) {
      const bounds = getRefugeBounds(selectedRefuge);
      if (bounds && bounds.isValid && bounds.isValid()) {
        try {
          // Calculate the zoom level that would fit these bounds
          const boundsFitZoom = map.getBoundsZoom(bounds, false, [24, 24]);
          // Cap the minimum zoom to the standard refuge zoom so user map never zooms past it
          const STANDARD_REFUGE_ZOOM = 16;
          const cappedMinZoom = Math.min(boundsFitZoom, STANDARD_REFUGE_ZOOM);
          // Set this as the minimum zoom - users can't zoom out further than this
          map.setMinZoom(cappedMinZoom);
          // If the current zoom is above the standard limit, pull it back to the cap
          const currentZoom = map.getZoom();
          if (Number.isFinite(currentZoom) && currentZoom > STANDARD_REFUGE_ZOOM) {
            map.setZoom(STANDARD_REFUGE_ZOOM);
          }
          // Restrict panning/zooming outside the selected refuge envelope (slight pad for UX)
          map.setMaxBounds(bounds.pad(0.05));
        } catch (e) {
          console.error('Error setting map zoom limits:', e);
        }
      }
    } else {
      // No refuge selected - reset to no minimum zoom
      try {
        map.setMinZoom(0);
        map.setMaxBounds(null);
      } catch (e) {}
    }
  }

  function syncSelectedRefugeUi() {
    const selectedId = selectedRefuge && selectedRefuge.id != null ? String(selectedRefuge.id) : null;
    document.querySelectorAll('.refuge-list-item').forEach((el) => {
      const rid = el.getAttribute('data-refuge-id');
      if (selectedId && rid === selectedId) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
        // On mobile, also blur any focused row to clear stuck visual states
        if (isMobile && document.activeElement === el) {
          try { el.blur(); } catch (e) {}
        }
      }
    });
  }

  // Mobile-only: hide all other refuge polygons when one is selected, restore when cleared
  function updateMobileRefugeVisibility() {
    if (!isMobile) return;
    const selectedId = selectedRefuge && selectedRefuge.id != null ? selectedRefuge.id : null;

    // Always restore anything we hid previously before applying a new filter
    if (mobileHiddenRefugeLayers.length) {
      mobileHiddenRefugeLayers.forEach((layer) => {
        try { refugeLayerGroup.addLayer(layer); } catch (e) {}
      });
      mobileHiddenRefugeLayers = [];
    }

    if (!selectedId) return;

    const toHide = [];
    refugeLayerGroup.eachLayer((layer) => {
      if (layer && layer._isRefugePolygon && layer._refuge && layer._refuge.id !== selectedId) {
        toHide.push(layer);
      }
    });

    toHide.forEach((layer) => {
      mobileHiddenRefugeLayers.push(layer);
      try { refugeLayerGroup.removeLayer(layer); } catch (e) {}
    });
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
        refugesCache = data.refuges;
        if (selectedRefuge && selectedRefuge.id != null) {
          const refreshed = data.refuges.find(r => r && r.id === selectedRefuge.id);
          if (refreshed) {
            selectedRefuge = refreshed;
          } else {
            selectedRefuge = null;
          }
        }
        applyRefugeSearchFilter();
        refugeLayerGroup.clearLayers();
        // Reset any previously hidden polygons before rebuilding the layer list
        mobileHiddenRefugeLayers = [];
        data.refuges.forEach(r => {
          try {
            if (r && r.polygon && (r.polygon.type === 'Polygon' || r.polygon.type === 'MultiPolygon')) {
              const geom = r.polygon;
              const drawPolygon = (polyCoords) => {
                const latlngs = (polyCoords || []).map(ring => ring.map(([lng, lat]) => [lat, lng]));
                if (!latlngs.length) return;
                const hoverAnchorLatLng = (latlngs && latlngs[0] && latlngs[0][0]) ? L.latLng(latlngs[0][0]) : null;
                let hoverNamePopup = null;
                const closeHoverNamePopup = () => {
                  if (hoverNamePopup) {
                    try { map.removeLayer(hoverNamePopup); } catch (err) {}
                    hoverNamePopup = null;
                  }
                };
                const openHoverNamePopup = () => {
                  if (!isDesktop) return;
                  if (!hoverAnchorLatLng) return;
                  if (!hasCompletedFirstZoom) return;
                  if (isPathConfigOpen() || window.__editing || drawing) return;
                  closeHoverNamePopup();
                  try {
                    hoverNamePopup = L.popup({
                      closeButton: false,
                      autoPan: false,
                      closeOnClick: false,
                      className: 'refuge-hover-popup',
                      offset: [0, -6]
                    })
                      .setLatLng(hoverAnchorLatLng)
                      .setContent(`<div class="refuge-hover-name">${escapeHtml(r.name || 'Refuge')}</div>`);
                    map.addLayer(hoverNamePopup);
                  } catch (err) {}
                };
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
                  // Close any hover popup immediately on click
                  closeHoverNamePopup();

                  // Ignore refuge interactions until the first zoom-in is done
                  if (!hasCompletedFirstZoom) {
                    return;
                  }

                  // Mark that a refuge was clicked to prevent map click from clearing selection
                  refugeClickedFlag = true;

                  // Block popups from opening while in edit mode or drawing mode
                  if (isPathConfigOpen() || window.__editing || drawing) {
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

                  // Clear any pending single-tap timer
                  if (refugeClickTimer) {
                    clearTimeout(refugeClickTimer);
                    refugeClickTimer = null;
                  }

                  const clickLatLng = e && e.latlng ? e.latlng : undefined;
                  const alreadySelected = selectedRefuge && selectedRefuge.id === polygon._refuge.id;

                  // Phone-specific behavior: double-tap to select like list, single tap for popup
                  if (isMobile) {
                    // Double-tap detected: treat as selection on map (also sets default in user map)
                    if (sinceLast > 0 && sinceLast < REFUGE_DOUBLE_CLICK_MS) {
                      console.log('Mobile double-tap detected on refuge:', polygon._refuge.name, 'sinceLast:', sinceLast);
                      refugeLastClickAt = 0; // Reset to prevent triple-tap issues
                      focusRefuge(polygon._refuge);
                      closeMobileRefugeNamePopup();
                      try { map.closePopup(); } catch (err) {}
                      // Prevent any further event handling
                      if (e && e.originalEvent) {
                        try { e.originalEvent.preventDefault(); } catch (err) {}
                        try { e.originalEvent.stopPropagation(); } catch (err) {}
                      }
                      return;
                    }

                    // Update last click time for next tap
                    refugeLastClickAt = now;

                    // Single tap: show popup after delay (to allow double-tap detection)
                    refugeClickTimer = setTimeout(() => {
                      refugeClickTimer = null;
                      if (!hasCompletedFirstZoom) return;
                      if (isPathConfigOpen() || window.__editing || drawing) return;

                      console.log('Mobile single-tap on refuge:', polygon._refuge.name);

                      // If another refuge is selected, ignore single taps on others
                      if (selectedRefuge && selectedRefuge.id != null && selectedRefuge.id !== polygon._refuge.id) {
                        closeMobileRefugeNamePopup();
                        return;
                      }

                      if (selectedRefuge && selectedRefuge.id === polygon._refuge.id) {
                        // Selected refuge: open full popup (with edit) on single tap (admin map only)
                        if (!isUserMapMode) {
                          closeMobileRefugeNamePopup();
                          try { polygon.openPopup(clickLatLng); } catch (err) {}
                        }
                        return;
                      }

                      // Unselected refuge: show name-only popup anchored at the first vertex
                      openMobileRefugeNamePopup(polygon._refuge, hoverAnchorLatLng);
                    }, REFUGE_DOUBLE_CLICK_MS + 20);
                    return;
                  }

                  // Update last click time for desktop
                  refugeLastClickAt = now;

                  const wasAlreadySelected = alreadySelected;
                  setSelectedRefuge(polygon._refuge);

                  if (sinceLast < REFUGE_DOUBLE_CLICK_MS) {
                    // Treat as double-click: suppress popup so map zoom can proceed
                    try { map.closePopup(); } catch (err) {}
                    return;
                  }

                  refugeClickTimer = setTimeout(() => {
                    refugeClickTimer = null;
                    if (!hasCompletedFirstZoom) return;
                    if (isPathConfigOpen() || window.__editing || drawing) return;

                    if (isDesktop) {
                      // Mirror list selection (zoom/focus) on desktop clicks
                      focusRefuge(polygon._refuge);
                      // First click only selects/focuses; second click opens full popup
                      if (!wasAlreadySelected) {
                        return;
                      }
                    }

                    if (!isUserMapMode) {
                      try { polygon.openPopup(clickLatLng); } catch (err) {}
                    }
                  }, REFUGE_DOUBLE_CLICK_MS + 20);
                };

                // Replace Leaflet's default click-to-open handler so we can apply timing
                polygon.off('click');
                polygon.on('click', handleRefugeClick);

                // Native touch handler for reliable double-tap detection on mobile
                if (isMobile) {
                  let refugeTouchLastTime = 0;
                  const polygonElement = polygon.getElement();
                  if (polygonElement) {
                    polygonElement.addEventListener('touchend', (ev) => {
                      if (!hasCompletedFirstZoom) return;
                      if (isPathConfigOpen() || window.__editing || drawing) return;
                      const now = Date.now();
                      const sinceLast = now - refugeTouchLastTime;
                      if (sinceLast > 0 && sinceLast < REFUGE_DOUBLE_CLICK_MS) {
                        console.log('Native touch double-tap detected on refuge:', polygon._refuge.name);
                        ev.preventDefault();
                        ev.stopPropagation();
                        refugeTouchLastTime = 0;
                        refugeClickedFlag = true;
                        // Clear any pending click timer
                        if (refugeClickTimer) {
                          clearTimeout(refugeClickTimer);
                          refugeClickTimer = null;
                        }
                        // Reset the click-based timer too
                        refugeLastClickAt = 0;
                        if (!isUserMapMode) {
                          selectRefugeLikeList(polygon._refuge);
                        }
                        closeMobileRefugeNamePopup();
                        try { map.closePopup(); } catch (err) {}
                      } else {
                        refugeTouchLastTime = now;
                      }
                    }, { passive: false });
                  }
                }

                // Explicit double-tap handler on mobile: mirror list selection
                polygon.on('dblclick', (e) => {
                  if (!isMobile) return;
                  if (!hasCompletedFirstZoom) return;
                  if (isPathConfigOpen() || window.__editing || drawing) return;
                  console.log('Leaflet dblclick event on refuge:', polygon._refuge.name);
                  refugeClickedFlag = true;
                  if (!isUserMapMode) {
                    selectRefugeLikeList(polygon._refuge);
                  }
                  closeMobileRefugeNamePopup();
                  try { map.closePopup(); } catch (err) {}
                  if (e && e.originalEvent) {
                    try { e.originalEvent.preventDefault(); } catch (err) {}
                    try { e.originalEvent.stopPropagation(); } catch (err) {}
                  }
                });

                // Show hover popup on mouseover only for unselected refuges
                polygon.on('mouseover', () => {
                  if (selectedRefuge && selectedRefuge.id === polygon._refuge.id) return;
                  openHoverNamePopup();
                });
                polygon.on('mouseout', () => {
                  closeHoverNamePopup();
                });

                polygon.on('popupopen', () => {
                  // Block refuge popups until the initial zoom completes
                  if (!hasCompletedFirstZoom) {
                    polygon.closePopup();
                    return;
                  }
                  // Close popup immediately if path config, editing mode, or drawing mode is active
                  if (isPathConfigOpen() || window.__editing || drawing) {
                    polygon.closePopup();
                    return;
                  }
                  // Hide edit popup entirely in user map mode
                  if (isUserMapMode) {
                    polygon.closePopup();
                    return;
                  }
                  // Hide edit popup entirely in user map mode
                  if (isUserMapMode) {
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
                          applyRefugeSearchFilter();
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
        // After rebuilding layers, apply mobile-only visibility filtering
        updateMobileRefugeVisibility();
      } else {
        refugesCache = [];
        applyRefugeSearchFilter();
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

  // Path configuration UI (mobile only): first prompt for name, then open full bar
  let pathRecording = { active: false, intervalId: null, polyline: null, points: [] };
  let pathNamePromptEl = null;
  let pathConfigBarEl = null;
  let pathConfigState = { id: null, name: '', points: [], markers: [], markerData: [], pathname_pups: {} };
  let savedPaths = [];
  let pathsByRefuge = [];
  const pathLayerGroup = L.layerGroup().addTo(map);
  const pathUserPopupLayer = L.layerGroup().addTo(map);
  let isUserMapMode = false;
  let userPopupWatchId = null;
  let seenUserPopups = new Set();
  const POPUP_NEARBY_METERS = 50;
  function isPathConfigOpen() {
    return !!(pathNamePromptEl || pathConfigBarEl);
  }
  function closePathConfigBar() {
    stopPathRecording(true);
    // Clean up markers
    if (pathConfigState.markers && Array.isArray(pathConfigState.markers)) {
      pathConfigState.markers.forEach(marker => {
        try {
          if (map && marker) map.removeLayer(marker);
        } catch (e) {}
      });
    }
    if (pathConfigBarEl) {
      try { pathConfigBarEl.remove(); } catch (e) {}
      pathConfigBarEl = null;
      pathConfigState = { id: null, name: '', points: [], markers: [], markerData: [], pathname_pups: {} };
    }
  }
  function closePathNamePrompt() {
    if (pathNamePromptEl) {
      try { pathNamePromptEl.remove(); } catch (e) {}
      pathNamePromptEl = null;
    }
  }
  async function createPathPlaceholder(name) {
    const res = await fetch(`${window.BACKEND_BASE_URL}/api/paths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'success') {
      const msg = (data && data.message) || `Failed to create path (${res.status})`;
      throw new Error(msg);
    }
    return data.path;
  }
  function setPathConfigName(name) {
    pathConfigState.name = name;
    const nameEl = pathConfigBarEl && pathConfigBarEl.querySelector('.path-config-name');
    if (nameEl) nameEl.textContent = name || '—';
  }
  function updateRecButtonUI() {
    const recBtn = pathConfigBarEl && pathConfigBarEl.querySelector('.path-config-rec');
    if (!recBtn) return;
    if (pathRecording.active) {
      recBtn.textContent = 'Pause';
      recBtn.classList.add('recording');
    } else {
      recBtn.textContent = 'Rec';
      recBtn.classList.remove('recording');
    }
  }
  function updatePathPolyline() {
    if (!map) return;
    const latLngs = (pathRecording.points || []).map(p => [p.lat, p.lng]);
    if (!pathRecording.polyline) {
      pathRecording.polyline = L.polyline(latLngs, {
        color: '#ffffff',
        weight: 4,
        opacity: 0.95,
        interactive: false
      }).addTo(map);
    } else {
      try { pathRecording.polyline.setLatLngs(latLngs); } catch (e) {}
    }
  }
  function stopPathRecording(removeLine = false) {
    if (pathRecording.intervalId) {
      try { clearInterval(pathRecording.intervalId); } catch (e) {}
      pathRecording.intervalId = null;
    }
    pathRecording.active = false;
    updateRecButtonUI();
    if (removeLine && pathRecording.polyline) {
      try { map && map.removeLayer && map.removeLayer(pathRecording.polyline); } catch (e) {}
      pathRecording.polyline = null;
    }
  }
  function startPathRecording() {
    if (pathRecording.active) return;
    if (!pathConfigState.id) {
      alert('Please name the path first.');
      return;
    }
    if (!navigator.geolocation) {
      alert('Geolocation not available.');
      return;
    }
    // Use existing points if present; otherwise reset
    pathRecording.points = (pathConfigState.points && Array.isArray(pathConfigState.points) && pathConfigState.points.length)
      ? [...pathConfigState.points]
      : [];
    // Ensure polyline exists/visible while recording
    updatePathPolyline();
    const sampleOnce = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!pos || !pos.coords) return;
          const lat = typeof pos.coords.latitude === 'number' ? pos.coords.latitude : null;
          const lng = typeof pos.coords.longitude === 'number' ? pos.coords.longitude : null;
          if (lat == null || lng == null) return;
          const pt = { lat, lng, t: Date.now() };
          pathRecording.points.push(pt);
          pathConfigState.points = [...pathRecording.points];
          updatePathPolyline();
        },
        (err) => { console.warn('Geolocation error during path recording', err); },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 8000
        }
      );
    };
    // Record immediately, then at walking cadence (every ~3s)
    sampleOnce();
    pathRecording.intervalId = setInterval(sampleOnce, 3000);
    pathRecording.active = true;
    updateRecButtonUI();
  }
  function pausePathRecording() {
    if (!pathRecording.active) return;
    stopPathRecording(false);
    // Ensure UI reflects paused state immediately
    const recBtn = pathConfigBarEl && pathConfigBarEl.querySelector('.path-config-rec');
    if (recBtn) {
      recBtn.textContent = 'Rec';
      recBtn.classList.remove('recording');
    }
  }
  function removeLastPathPoint() {
    if (!Array.isArray(pathRecording.points) || !pathRecording.points.length) return;
    pathRecording.points.pop();
    pathConfigState.points = [...pathRecording.points];
    updatePathPolyline();
  }
  function renderSavedPaths(paths) {
    try { pathLayerGroup.clearLayers(); } catch (e) {}
    try { pathUserPopupLayer.clearLayers(); } catch (e) {}
    if (!Array.isArray(paths)) return;
    paths.forEach((p) => {
      const pts = Array.isArray(p.points) ? p.points : [];
      const latLngs = pts.map(pt => [pt.lat, pt.lng]).filter(ll => Array.isArray(ll) && ll.length === 2);
      if (latLngs.length) {
        const poly = L.polyline(latLngs, {
          color: '#ffffff',
          weight: 4,
          opacity: 0.95
        }).addTo(pathLayerGroup);
        if (p.name) {
          poly.bindPopup(String(p.name));
        }
      }
      // Only render popups/markers on user map
      if (isUserMapMode) {
        const markers = Array.isArray(p.markers) ? p.markers : [];
        markers.forEach(m => {
          if (m && typeof m.lat === 'number' && typeof m.lng === 'number') {
            const marker = L.marker([m.lat, m.lng], {
              icon: L.divIcon({
                className: 'path-popup-marker',
                html: '<i class="fas fa-map-pin" style="color: #4caf50; font-size: 20px;"></i>',
                iconSize: [20, 20],
                iconAnchor: [10, 20]
              })
            }).addTo(pathUserPopupLayer);
            if (m.text) marker.bindPopup(String(m.text));
          }
        });
        const pupsObj = (p.pathname_pups && typeof p.pathname_pups === 'object') ? p.pathname_pups : {};
        Object.entries(pupsObj).forEach(([key, m]) => {
          if (!m) return;
          const idx = Number(key);
          const pathLatLng = (Number.isFinite(idx) && latLngs[idx]) ? latLngs[idx] : null;
          const popupLat = pathLatLng ? pathLatLng[0] : (typeof m.lat === 'number' ? m.lat : null);
          const popupLng = pathLatLng ? pathLatLng[1] : (typeof m.lng === 'number' ? m.lng : null);
          if (popupLat == null || popupLng == null) return;
          const marker = L.marker([popupLat, popupLng], {
            icon: L.divIcon({
              className: 'path-popup-marker',
              html: '<i class="fas fa-map-pin" style="color: #ff9800; font-size: 20px;"></i>',
              iconSize: [20, 20],
              iconAnchor: [10, 20]
            })
          }).addTo(pathUserPopupLayer);
          if (m.caption || m.image_url) {
            let html = '';
            if (m.image_url) {
              html += `<div style="margin-bottom:6px;"><img src="${m.image_url}" alt="" style="max-width:160px;max-height:120px;object-fit:cover;border-radius:6px;" /></div>`;
            }
            if (m.caption) {
              html += `<div style="font-weight:600;">${escapeHtml(m.caption)}</div>`;
            }
            if (!html) html = 'Popup';
            marker.bindPopup(html);
          }
          marker._popupKey = `${p.id || 'p'}:${Number.isFinite(idx) ? idx : key}`;
        });
      }
    });
  }
  async function loadSavedPaths() {
    try {
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/paths`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.status === 'success' && Array.isArray(data.paths)) {
        savedPaths = data.paths;
        pathsByRefuge = Array.isArray(data.paths_by_refuge) ? data.paths_by_refuge : [];
        renderSavedPaths(savedPaths);
      } else {
        pathsByRefuge = [];
      }
    } catch (e) {
      console.warn('Failed to load paths', e);
      pathsByRefuge = [];
    }
  }
  function stopUserPopupWatch() {
    if (userPopupWatchId !== null) {
      try { navigator.geolocation.clearWatch(userPopupWatchId); } catch (e) {}
      userPopupWatchId = null;
    }
    seenUserPopups = new Set();
    try { pathUserPopupLayer.clearLayers(); } catch (e) {}
  }

  function getPathNamesForRefuge(refugeId) {
    if (refugeId == null) return [];
    const entry = Array.isArray(pathsByRefuge)
      ? pathsByRefuge.find((p) => String(p.refuge_id) === String(refugeId))
      : null;
    const names = entry && Array.isArray(entry.path_names) ? entry.path_names : [];
    return names;
  }
  function deg2rad(d) { return d * Math.PI / 180; }
  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000;
    const dLat = deg2rad(b.lat - a.lat);
    const dLng = deg2rad(b.lng - a.lng);
    const lat1 = deg2rad(a.lat);
    const lat2 = deg2rad(b.lat);
    const sinDlat = Math.sin(dLat / 2);
    const sinDlng = Math.sin(dLng / 2);
    const h = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlng * sinDlng;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function startUserPopupWatch() {
    stopUserPopupWatch();
    if (!navigator.geolocation) return;
    userPopupWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!pos || !pos.coords) return;
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // Lazy render paths if not yet shown
        renderSavedPaths(savedPaths);
        // Check proximity to popup markers in the user layer
        const layers = [];
        try { pathUserPopupLayer.eachLayer(l => layers.push(l)); } catch (e) {}
        layers.forEach(l => {
          const ll = l.getLatLng && l.getLatLng();
          if (!ll) return;
          const dist = distanceMeters(here, { lat: ll.lat, lng: ll.lng });
          const key = l._popupKey || `${ll.lat},${ll.lng}`;
          if (dist <= POPUP_NEARBY_METERS) {
            if (!seenUserPopups.has(key)) {
              seenUserPopups.add(key);
              try { l.openPopup && l.openPopup(); } catch (e) {}
            }
          } else {
            try { l.closePopup && l.closePopup(); } catch (e) {}
          }
        });
      },
      (err) => { console.warn('User popup geolocation watch error', err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  }
  async function saveCurrentPath() {
    if (!pathConfigState.id) {
      alert('Please name the path first.');
      return;
    }
    pausePathRecording();
    const payload = {
      name: pathConfigState.name || '',
      points: pathConfigState.points || [],
      markers: pathConfigState.markerData || [],
      pathname_pups: pathConfigState.pathname_pups || {}
    };
    try {
      const res = await fetch(`${window.BACKEND_BASE_URL}/api/paths/${pathConfigState.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || data.status !== 'success') {
        alert((data && data.message) || `Failed to save path (${res.status})`);
        return;
      }
      // Refresh saved paths and close bar
      await loadSavedPaths();
      closePathConfigBar();
    } catch (err) {
      alert(err && err.message ? err.message : 'Failed to save path');
    }
  }
  function openFullPathConfigBar(pathInfo) {
    if (!isMobile) {
      alert('Path configuration is available on phone only.');
      return;
    }
    closePathConfigBar();
    pathConfigState = {
      id: pathInfo?.id || null,
      name: pathInfo?.name || '',
      points: pathInfo?.points || [],
      markers: [],
      markerData: pathInfo?.markers || [],
      pathname_pups: (pathInfo && typeof pathInfo.pathname_pups === 'object') ? pathInfo.pathname_pups : {}
    };
    pathRecording.points = [...(pathConfigState.points || [])];
    stopPathRecording(true);
    pathConfigBarEl = document.createElement('div');
    pathConfigBarEl.className = 'path-config-bar';
    pathConfigBarEl.innerHTML = `
      <div class="path-config-header">
        <span class="path-config-title">Configuration path</span>
        <button class="path-config-cancel" type="button" aria-label="Cancel">✕</button>
      </div>
      <div class="path-config-name-row">
        <span class="path-config-name"></span>
        <button class="path-config-rename-btn" type="button" title="Rename">Rename</button>
      </div>
      <div class="path-config-buttons-row">
        <button class="path-config-rec" type="button">Rec</button>
        <button class="path-config-undo" type="button">Undo</button>
      </div>
      <button class="path-config-add-popup" type="button">Add popup</button>
      <div class="path-config-footer">
        <button class="path-config-delete" type="button">Delete</button>
        <button class="path-config-save" type="button">Save</button>
      </div>
    `;
    document.body.appendChild(pathConfigBarEl);

    // Set initial name
    setPathConfigName(pathConfigState.name);
    if (pathRecording.points && pathRecording.points.length) {
      updatePathPolyline();
    }
    updateRecButtonUI();

    const cancelBtn = pathConfigBarEl.querySelector('.path-config-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closePathConfigBar);

    const renameBtn = pathConfigBarEl.querySelector('.path-config-rename-btn');
    const nameEl = pathConfigBarEl.querySelector('.path-config-name');
    if (renameBtn && nameEl) {
      let isEditing = false;
      
      renameBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!isEditing) {
          // Switch to edit mode
          isEditing = true;
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'path-config-name-input';
          input.value = pathConfigState.name || '';
          try { input.size = Math.max(1, (pathConfigState.name || '').length + 1); } catch (err) {}
          nameEl.parentNode.replaceChild(input, nameEl);
          input.focus();
          input.select();
          renameBtn.textContent = 'Save';
          renameBtn.title = 'Save name';
          input.addEventListener('input', () => {
            try { input.size = Math.max(1, (input.value || '').length + 1); } catch (err) {}
          });
          
          // Allow Enter key to save, Escape to cancel
          input.onkeydown = (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              renameBtn.click();
            } else if (ev.key === 'Escape') {
              ev.preventDefault();
              // Restore original name and cancel
              input.parentNode.replaceChild(nameEl, input);
              isEditing = false;
              renameBtn.textContent = 'Rename';
              renameBtn.title = 'Rename';
            }
          };
        } else {
          // Save mode
          const input = pathConfigBarEl.querySelector('.path-config-name-input');
          if (!input) return;
          
          const newName = input.value.trim();
          if (!newName) {
            alert('Name cannot be empty');
            return;
          }
          
          // Update the stored name and UI
          pathConfigState.name = newName;
          nameEl.textContent = newName;
          
          // Restore view mode
          input.parentNode.replaceChild(nameEl, input);
          isEditing = false;
          renameBtn.textContent = 'Rename';
          renameBtn.title = 'Rename';
        }
      });
    }

    const recBtn = pathConfigBarEl.querySelector('.path-config-rec');
    if (recBtn) {
      recBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pathRecording.active) {
          pausePathRecording();
        } else {
          startPathRecording();
        }
      });
    }
    const undoBtn = pathConfigBarEl.querySelector('.path-config-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeLastPathPoint();
      });
    }

    const addPopupBtn = pathConfigBarEl.querySelector('.path-config-add-popup');
    if (addPopupBtn) {
      addPopupBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Require points to relate to
        if (!Array.isArray(pathConfigState.points) || !pathConfigState.points.length) {
          alert('Add some points to the path before adding a popup.');
          return;
        }
        // Get current center of map
        if (!map) {
          alert('Map not available');
          return;
        }
        
        const center = map.getCenter();
        const caption = prompt('Enter popup caption (small text):') || '';
        const img = prompt('Enter image URL (optional):') || '';
        const captionClean = caption.trim();
        const imgClean = img.trim();
        if (!captionClean && !imgClean) {
          alert('Caption or image is required.');
          return;
        }

        // Find nearest point index to current center
        const nearestIdx = (() => {
          let bestIdx = 0;
          let bestDist = Infinity;
          pathConfigState.points.forEach((pt, idx) => {
            if (pt && typeof pt.lat === 'number' && typeof pt.lng === 'number') {
              const dLat = pt.lat - center.lat;
              const dLng = pt.lng - center.lng;
              const dist2 = dLat * dLat + dLng * dLng;
              if (dist2 < bestDist) {
                bestDist = dist2;
                bestIdx = idx;
              }
            }
          });
          return bestIdx;
        })();

        const attachPoint = (Array.isArray(pathConfigState.points) && pathConfigState.points[nearestIdx]) || {};
        const attachLat = (attachPoint && typeof attachPoint.lat === 'number') ? attachPoint.lat : center.lat;
        const attachLng = (attachPoint && typeof attachPoint.lng === 'number') ? attachPoint.lng : center.lng;

        // Add a marker with popup snapped to the nearest path point (fallback: center)
        const marker = L.marker([attachLat, attachLng], {
          icon: L.divIcon({
            className: 'path-popup-marker',
            html: '<i class="fas fa-map-pin" style="color: #ff9800; font-size: 24px;"></i>',
            iconSize: [24, 24],
            iconAnchor: [12, 24]
          })
        }).addTo(map);
        
        let popupHtml = '';
        if (imgClean) {
          popupHtml += `<div style="margin-bottom:6px;"><img src="${imgClean}" alt="" style="max-width:160px;max-height:120px;object-fit:cover;border-radius:6px;" /></div>`;
        }
        if (captionClean) {
          popupHtml += `<div style="font-weight:600;">${escapeHtml(captionClean)}</div>`;
        }
        marker.bindPopup(popupHtml || 'Popup').openPopup();
        
        // Store marker reference for later cleanup if needed
        if (!pathConfigState.markers) {
          pathConfigState.markers = [];
        }
        pathConfigState.markers.push(marker);
        if (!pathConfigState.markerData) pathConfigState.markerData = [];
        pathConfigState.markerData.push({ lat: attachLat, lng: attachLng, text: captionClean });
        if (!pathConfigState.pathname_pups || typeof pathConfigState.pathname_pups !== 'object') pathConfigState.pathname_pups = {};
        const pupEntry = { lat: attachLat, lng: attachLng, caption: captionClean, image_url: imgClean, point_index: nearestIdx };
        pathConfigState.pathname_pups[String(nearestIdx)] = pupEntry;

        // Send to backend immediately
        if (pathConfigState.id) {
          try {
            await fetch(`${window.BACKEND_BASE_URL}/api/paths/${pathConfigState.id}/popups`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caption: captionClean,
                image_url: imgClean,
                point_index: nearestIdx,
                lat: attachLat,
                lng: attachLng
              })
            });
          } catch (err) {
            console.warn('Failed to save popup to backend', err);
          }
        }
      });
    }

    const saveBtn = pathConfigBarEl.querySelector('.path-config-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await saveCurrentPath();
      });
    }
  }
  async function openPathNamePrompt(refugeContext) {
    if (!isMobile) {
      alert('Path configuration is available on phone only.');
      return;
    }
    const activeRefuge = (refugeContext && refugeContext.id != null) ? refugeContext : selectedRefuge;
    if (!activeRefuge || activeRefuge.id == null) {
      alert('Select a refuge first by tapping a refuge on the map or list.');
      return;
    }
    if (!pathsByRefuge || !pathsByRefuge.length) {
      try { await loadSavedPaths(); } catch (e) {}
    }
    const refugePathNames = getPathNamesForRefuge(activeRefuge.id);
    const safeRefugeName = escapeHtml(activeRefuge.name || 'Refuge');
    closePathConfigBar();
    closePathNamePrompt();
    pathNamePromptEl = document.createElement('div');
    pathNamePromptEl.className = 'path-config-bar path-name-prompt';
    pathNamePromptEl.innerHTML = `
      <div class="path-config-header">
        <span class="path-config-title">Configuration path</span>
        <button class="path-config-cancel" type="button" aria-label="Cancel">✕</button>
      </div>
      <div class="path-refuge-summary">
        <div class="path-refuge-label">Selected refuge</div>
        <div class="path-refuge-name">${safeRefugeName}</div>
      </div>
      <div class="path-refuge-paths">
        <div class="path-refuge-paths-header">
          <span class="path-refuge-paths-title">Paths in refuge</span>
          <button class="path-refuge-paths-new" type="button">+ New</button>
        </div>
        <div class="path-refuge-paths-row"></div>
      </div>
      <div class="path-config-input-row" data-role="name-row">
        <label class="path-config-label path-config-label-top" for="path-name-input">name</label>
        <div class="path-config-input-wrap">
          <input id="path-name-input" class="path-config-input" type="text" placeholder="Enter path name" aria-label="Path name" />
          <button class="path-config-ok" type="button">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(pathNamePromptEl);

    const cancelBtn = pathNamePromptEl.querySelector('.path-config-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closePathNamePrompt);

    const nameRow = pathNamePromptEl.querySelector('[data-role="name-row"]');
    const nameInput = pathNamePromptEl.querySelector('.path-config-input');
    const okBtn = pathNamePromptEl.querySelector('.path-config-ok');
    if (nameRow) {
      nameRow.style.display = 'none';
    }
    if (okBtn) okBtn.disabled = true;

    const pathRow = pathNamePromptEl.querySelector('.path-refuge-paths-row');
    if (pathRow) {
      pathRow.innerHTML = '';
      if (refugePathNames.length) {
        refugePathNames.forEach((nm) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'path-refuge-path-pill';
          pill.textContent = nm;
          
          // Handle pill activation (click or keyboard)
          const handlePillActivation = () => {
            try {
              pathRow.querySelectorAll('.path-refuge-path-pill.selected').forEach((el) => el.classList.remove('selected'));
            } catch (e) {}
            pill.classList.add('selected');
          };
          
          pill.addEventListener('click', handlePillActivation);
          
          pill.addEventListener('keydown', (e) => {
            // Handle Enter and Space for keyboard activation
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handlePillActivation();
            }
          });
          
          pathRow.appendChild(pill);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'path-refuge-paths-empty';
        empty.textContent = 'No paths yet for this refuge.';
        pathRow.appendChild(empty);
      }
    }

    const showNameInput = () => {
      if (nameRow) nameRow.style.display = '';
      if (okBtn) okBtn.disabled = false;
      if (nameInput && typeof nameInput.focus === 'function') {
        nameInput.focus();
      }
    };
    const newBtn = pathNamePromptEl.querySelector('.path-refuge-paths-new');
    if (newBtn) {
      const triggerShow = (ev) => {
        ev && ev.preventDefault && ev.preventDefault();
        ev && ev.stopPropagation && ev.stopPropagation();
        showNameInput();
      };
      newBtn.addEventListener('click', triggerShow);
      newBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          triggerShow(e);
        }
      });
    }

    const triggerOk = async () => {
      const rawName = (nameInput && nameInput.value) ? nameInput.value.trim() : '';
      if (!rawName) {
        alert('Please enter a path name.');
        return;
      }
      if (okBtn) okBtn.disabled = true;
      try {
        const created = await createPathPlaceholder(rawName);
        closePathNamePrompt();
        openFullPathConfigBar(created);
      } catch (err) {
        alert(err && err.message ? err.message : 'Failed to save path');
      } finally {
        if (okBtn) okBtn.disabled = false;
      }
    };
    if (okBtn) okBtn.addEventListener('click', triggerOk);
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerOk();
        }
      });
    }
  }

  async function startPathFlow() {
    if (!selectedRefuge || selectedRefuge.id == null) {
      alert('Select a refuge first by tapping a refuge on the map or list.');
      return;
    }
    await openPathNamePrompt(selectedRefuge);
  }

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
      
      // Make item focusable for keyboard navigation
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'menuitem');
      
      // Handle option activation (click or keyboard)
      const handleOptionActivation = (e) => {
        e.stopPropagation();
        // Block option logic while drawing is active, except for layer panel actions
        // Also allow layer button during edit mode
        if (isPathConfigOpen()) return;
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
      };
      
      item.addEventListener('click', handleOptionActivation);
      
      item.addEventListener('keydown', (e) => {
        // Handle Enter and Space for keyboard activation
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOptionActivation(e);
        }
      });
      
      panel.appendChild(item);
    });
    
    button.appendChild(panel);
    
    // Toggle panel on button click
    button.onclick = function(e) {
      e.stopPropagation();
      // Block opening option panels while drawing, except allow the layer panel
      // Also allow layer button during edit mode
      if (isPathConfigOpen()) return;
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
        if (!hasCompletedFirstZoom) {
          disableFirstTapZoom();
        }
        // Center button is now always available (no longer blocked before first zoom)
        // Do not interfere while drawing or editing
        if (isPathConfigOpen()) return;
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
  let currentLayer = defaultBaseLayerId || null;

  const layerOptions = validBaseLayers.map((layer) => ({
    icon: layer.icon || 'fas fa-layer-group',
    text: layer.name || layer.id,
    action: function() {
      document.querySelectorAll('.option-panel').forEach((p) => p.classList.remove('show'));
      Object.values(baseLayerInstances).forEach((instance) => {
        try { map.removeLayer(instance); } catch (err) {}
      });
      const targetLayer = baseLayerInstances[layer.id];
      if (targetLayer) {
        targetLayer.addTo(map);
        currentLayer = layer.id;
      }
    }
  }));
  if (layerOptions.length) {
    createOptionPanel('btn-layer', layerOptions);
  }

  // Drawing button options
  createOptionPanel('btn-drawing', [
    {
      icon: 'fas fa-route',
      text: 'Path',
      action: async function() {
        document.querySelectorAll('.option-panel').forEach(p => p.classList.remove('show'));
        await startPathFlow();
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
      if (isPathConfigOpen()) return;
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      try { map && map.closePopup && map.closePopup(); } catch (err) {}
      openSidePanel();
    });
    sideClose.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isPathConfigOpen()) return;
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      closeSidePanel();
    });
    menuOverlay.addEventListener('click', function () {
      if (isPathConfigOpen()) return;
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      closeSidePanel();
    });
  }

  // Menu item actions
  const menuActions = {
    'about': () => {
      alert('About: Coming soon.');
      // Keep menu open when switching views
    },
    'data': () => {
      alert('Data: Coming soon.');
      // Keep menu open when switching views
    },
    'admin-map': () => {
      // Save current map state before switching
      saveCurrentMapState();
      
      // Switch to admin map mode
      isUserMapMode = false;
      stopUserPopupWatch();
      document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
      const item = document.querySelector('.menu-item[data-action="admin-map"]');
      if (item) item.classList.add('active');
      
      // Restore admin map state
      restoreSelectionForCurrentMode();
      applyRefugeSearchFilter(); // Re-render list with admin static default tick
      renderSavedPaths(savedPaths);
      updateMapZoomLimits();
      
      // Remove user-map-mode class from body
      document.body.classList.remove('user-map-mode');
      // Keep menu open when switching views
    },
    'user-map': () => {
      // Save current map state before switching
      saveCurrentMapState();
      
      // Switch to user map mode
      isUserMapMode = true;
      seenUserPopups = new Set();
      document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
      const item = document.querySelector('.menu-item[data-action="user-map"]');
      if (item) item.classList.add('active');
      
      // Restore user map state
      restoreSelectionForCurrentMode();
      applyRefugeSearchFilter(); // Re-render list with user-map radio controls
      renderSavedPaths(savedPaths);
      startUserPopupWatch();
      updateMapZoomLimits();
      
      // Add user-map-mode class to body for CSS targeting
      document.body.classList.add('user-map-mode');
      // Keep menu open when switching views
    }
  };

  document.querySelectorAll('.menu-item').forEach(btn => {
    // Make menu items focusable for keyboard navigation
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('role', 'menuitem');
    
    // Handle menu item activation (click or keyboard)
    const handleMenuActivation = function() {
      if (isPathConfigOpen()) return;
      if ((typeof drawing !== 'undefined' && drawing) || (window.__editing)) return;
      try { map && map.closePopup && map.closePopup(); } catch (err) {}
      const action = btn.getAttribute('data-action');
      const handler = menuActions[action];
      if (typeof handler === 'function') handler();
    };
    
    btn.addEventListener('click', handleMenuActivation);
    
    btn.addEventListener('keydown', (e) => {
      // Handle Enter and Space for keyboard activation
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleMenuActivation();
      }
    });
  });

  // Location search: search by place name or "lat,lng" and move map
  (function setupLocationSearch() {
    const input = document.getElementById('location-search-input');
    const button = document.getElementById('location-search-btn');
    const dropdown = document.getElementById('live-search-dropdown');
    if (!input || !button) return;

    let nominatimDebounce = null;
    let nominatimCache = {};
    let highlightedIndex = -1;
    let currentResults = [];

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

    const highlightMatch = (text, query) => {
      if (!query) return escapeHtml(text);
      const escaped = escapeHtml(text);
      const safeQuery = query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(${safeQuery})`, 'gi');
      return escaped.replace(regex, '<span class="highlight">$1</span>');
    };

    const hideDropdown = () => {
      if (dropdown) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
      }
      highlightedIndex = -1;
      currentResults = [];
    };

    const showDropdown = () => {
      if (dropdown) dropdown.classList.add('active');
    };

    const selectResult = (result) => {
      hideDropdown();
      if (result.type === 'refuge') {
        focusRefuge(result.refuge);
      } else if (result.type === 'location') {
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          map.setView([lat, lng], Math.max(map.getZoom() || COUNTRY_ZOOM, 12));
          try { closeSidePanel && closeSidePanel(); } catch (e) {}
        }
      } else if (result.type === 'coords') {
        map.setView([result.lat, result.lng], Math.max(map.getZoom() || COUNTRY_ZOOM, 12));
        try { closeSidePanel && closeSidePanel(); } catch (e) {}
      }
      input.value = '';
      applyRefugeSearchFilter();
    };

    const updateHighlight = () => {
      const items = dropdown.querySelectorAll('.live-search-item');
      items.forEach((item, idx) => {
        if (idx === highlightedIndex) {
          item.classList.add('highlighted');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('highlighted');
        }
      });
    };

    const renderDropdown = (refugeResults, locationResults, query, isLoading = false) => {
      if (!dropdown) return;
      
      currentResults = [];
      let html = '';
      
      // Check for coordinate input
      const coords = parseLatLng(query);
      if (coords) {
        currentResults.push({ type: 'coords', lat: coords.lat, lng: coords.lng });
        html += `
          <div class="live-search-section">
            <div class="live-search-section-header">
              <i class="fas fa-crosshairs"></i>
              Coordinates
            </div>
            <div class="live-search-item" data-index="0" tabindex="0">
              <div class="live-search-item-icon location-icon">
                <i class="fas fa-map-pin"></i>
              </div>
              <div class="live-search-item-content">
                <div class="live-search-item-name">Go to ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}</div>
                <div class="live-search-item-meta">Navigate to coordinates</div>
              </div>
            </div>
          </div>
        `;
      }
      
      // Refuge results
      if (refugeResults.length > 0) {
        const startIdx = currentResults.length;
        html += `
          <div class="live-search-section">
            <div class="live-search-section-header">
              <i class="fas fa-shield-halved"></i>
              Refuges (${refugeResults.length})
            </div>
        `;
        refugeResults.slice(0, 5).forEach((refuge, idx) => {
          currentResults.push({ type: 'refuge', refuge });
          html += `
            <div class="live-search-item" data-index="${startIdx + idx}" tabindex="0">
              <div class="live-search-item-icon refuge-icon">
                <i class="fas fa-shield-halved"></i>
              </div>
              <div class="live-search-item-content">
                <div class="live-search-item-name">${highlightMatch(refuge.name || 'Unnamed refuge', query)}</div>
                <div class="live-search-item-meta">Refuge area</div>
              </div>
            </div>
          `;
        });
        html += '</div>';
      }
      
      // Location results
      if (locationResults.length > 0) {
        const startIdx = currentResults.length;
        html += `
          <div class="live-search-section">
            <div class="live-search-section-header">
              <i class="fas fa-map-location-dot"></i>
              Map Locations (${locationResults.length})
            </div>
        `;
        locationResults.slice(0, 5).forEach((loc, idx) => {
          currentResults.push({ type: 'location', lat: loc.lat, lng: loc.lon, name: loc.display_name });
          const shortName = loc.display_name.split(',')[0];
          const meta = loc.display_name.split(',').slice(1, 3).join(',').trim() || loc.type || 'Location';
          html += `
            <div class="live-search-item" data-index="${startIdx + idx}" tabindex="0">
              <div class="live-search-item-icon location-icon">
                <i class="fas fa-location-dot"></i>
              </div>
              <div class="live-search-item-content">
                <div class="live-search-item-name">${highlightMatch(shortName, query)}</div>
                <div class="live-search-item-meta">${escapeHtml(meta)}</div>
              </div>
            </div>
          `;
        });
        html += '</div>';
      }
      
      // Loading state for locations
      if (isLoading && !coords) {
        html += `
          <div class="live-search-loading">
            <div class="spinner"></div>
            <span>Searching map locations...</span>
          </div>
        `;
      }
      
      // Empty state
      if (!html && !isLoading) {
        html = `
          <div class="live-search-empty">
            <i class="fas fa-search"></i>
            No results found for "${escapeHtml(query)}"
          </div>
        `;
      }
      
      dropdown.innerHTML = html;
      showDropdown();
      highlightedIndex = -1;
      
      // Attach click handlers
      dropdown.querySelectorAll('.live-search-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(item.dataset.index, 10);
          if (currentResults[idx]) {
            selectResult(currentResults[idx]);
          }
        });
      });
    };

    const fetchNominatimResults = async (query) => {
      if (nominatimCache[query]) {
        return nominatimCache[query];
      }
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q='
          + encodeURIComponent(query);
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });
        const results = await res.json().catch(() => []);
        nominatimCache[query] = Array.isArray(results) ? results : [];
        return nominatimCache[query];
      } catch (err) {
        console.warn('Nominatim search failed', err);
        return [];
      }
    };

    const doLiveSearch = async (query) => {
      if (!query) {
        hideDropdown();
        return;
      }

      // Filter refuges locally (instant)
      const refugeResults = refugesCache.filter((r) =>
        normalizeRefugeName(r.name).includes(normalizeRefugeName(query))
      );
      
      // Show refuges immediately, with loading indicator for locations
      renderDropdown(refugeResults, [], query, true);
      
      // Debounced Nominatim search
      if (nominatimDebounce) clearTimeout(nominatimDebounce);
      nominatimDebounce = setTimeout(async () => {
        const locationResults = await fetchNominatimResults(query);
        // Re-filter refuges in case cache changed
        const freshRefugeResults = refugesCache.filter((r) =>
          normalizeRefugeName(r.name).includes(normalizeRefugeName(query))
        );
        renderDropdown(freshRefugeResults, locationResults, query, false);
      }, 300);
    };

    const performSearch = async () => {
      const query = (input.value || '').trim();
      if (!query) return;
      hideDropdown();
      // Block while drawing or editing
      if (isPathConfigOpen()) return;
      if ((typeof drawing !== 'undefined' && drawing) || window.__editing) return;

      // 1) Try coordinates first
      const coords = parseLatLng(query);
      if (coords) {
        map.setView([coords.lat, coords.lng], Math.max(map.getZoom() || COUNTRY_ZOOM, 10));
        try { closeSidePanel && closeSidePanel(); } catch (e) {}
        input.value = '';
        applyRefugeSearchFilter();
        return;
      }

      // 2) Try matching a refuge name
      const nameMatches = applyRefugeSearchFilter();
      if (Array.isArray(nameMatches) && nameMatches.length) {
        focusRefuge(nameMatches[0]);
        input.value = '';
        applyRefugeSearchFilter();
        return;
      }

      // 3) Fallback to name search via Nominatim
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
      input.value = '';
      applyRefugeSearchFilter();
    };

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      performSearch();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && currentResults[highlightedIndex]) {
          selectResult(currentResults[highlightedIndex]);
        } else {
          performSearch();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentResults.length > 0) {
          highlightedIndex = Math.min(highlightedIndex + 1, currentResults.length - 1);
          updateHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentResults.length > 0) {
          highlightedIndex = Math.max(highlightedIndex - 1, 0);
          updateHighlight();
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });

    input.addEventListener('input', () => {
      const query = (input.value || '').trim();
      // Save search query to current map state
      if (isUserMapMode) {
        userMapState.searchQuery = query;
      } else {
        adminMapState.searchQuery = query;
      }
      applyRefugeSearchFilter();
      doLiveSearch(query);
    });

    input.addEventListener('focus', () => {
      const query = (input.value || '').trim();
      if (query) {
        doLiveSearch(query);
      }
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target) && !button.contains(e.target)) {
        hideDropdown();
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
    let statusClearTimer = null;
    const controlsEl = hud.querySelector('.hud-controls');
    const undoRowEl = hud.querySelector('.hud-drawing-undo-row');
    const undoBtnEl = hud.querySelector('.hud-undo');
    const setStatus = (text, kind = 'info', options = {}) => {
      if (!statusEl) return;
      const opts = (kind && typeof kind === 'object' && !Array.isArray(kind)) ? kind : (options || {});
      const normalizedKind = (typeof kind === 'string') ? kind : (opts.kind || 'info');
      if (statusClearTimer) {
        try { clearTimeout(statusClearTimer); } catch (e) {}
        statusClearTimer = null;
      }
      const safe = (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      statusEl.innerHTML = safe;
      statusEl.classList.remove('status-info', 'status-error', 'status-success');
      statusEl.classList.add(`status-${normalizedKind}`);
      statusEl.style.display = '';
      if (opts && Number.isFinite(opts.autoHideMs)) {
        statusClearTimer = setTimeout(() => {
          if (!statusEl) return;
          statusEl.innerHTML = '';
          statusEl.classList.remove('status-info', 'status-error', 'status-success');
          if (opts.hideBar) {
            statusEl.style.display = 'none';
          }
          if (opts.closeHud) {
            try {
              if (hud && hud.parentNode) {
                hud.remove();
              }
            } catch (e) {}
          }
        }, opts.autoHideMs);
      }
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
        setStatus && setStatus(overlapMsg, 'error', { autoHideMs: 1000, hideBar: true, closeHud: true });
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
