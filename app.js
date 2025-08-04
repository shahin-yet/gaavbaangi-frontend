// Wait for the DOM to be fully loaded
window.addEventListener('DOMContentLoaded', function () {
  // Initialize the map
  const map = L.map('map', {
    center: [20.5937, 78.9629], // Centered on India as an example
    zoom: 5,
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

  // Layer control
  const baseMaps = {
    "Satellite": satellite,
    "Terrain": terrain
  };
  L.control.layers(baseMaps).addTo(map);

  // Drawing control (keep only drawing logic, no upload/export)
  const DrawingControl = L.Control.extend({
    options: {
      position: 'topleft'
    },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom drawing-control');
      // Drawing button
      const button = L.DomUtil.create('div', 'drawing-button', container);
      button.innerHTML = '<i class="fas fa-draw-polygon"></i>';
      button.title = 'Drawing Tools';
      // Dropdown panel
      const panel = L.DomUtil.create('div', 'drawing-panel', container);
      panel.style.display = 'none';
      panel.innerHTML = `
        <div class="drawing-option" data-type="route">
          <input type="radio" name="drawing-type" id="route-option" value="route">
          <label for="route-option">
            <i class="fas fa-route"></i>
            Route
          </label>
        </div>
        <div class="drawing-option" data-type="refuge">
          <input type="radio" name="drawing-type" id="refuge-option" value="refuge">
          <label for="refuge-option">
            <i class="fas fa-shield-alt"></i>
            Refuge Area
          </label>
        </div>
        <div class="drawing-option" data-type="marker">
          <input type="radio" name="drawing-type" id="marker-option" value="marker">
          <label for="marker-option">
            <i class="fas fa-map-marker-alt"></i>
            Point Marker
          </label>
        </div>
      `;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(container, 'mouseenter', function(e) {
        panel.style.display = 'block';
        button.classList.add('active');
      });
      L.DomEvent.on(container, 'mouseleave', function(e) {
        panel.style.display = 'none';
        button.classList.remove('active');
      });
      L.DomEvent.on(panel, 'click', function(e) {
        const option = e.target.closest('.drawing-option');
        if (option) {
          const type = option.dataset.type;
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          updateDrawingButton(button, type);
          handleDrawingAction(type, map);
        }
      });
      return container;
    }
  });
  function updateDrawingButton(button, type) {
    const icons = {
      'route': 'fas fa-route',
      'refuge': 'fas fa-shield-alt',
      'marker': 'fas fa-map-marker-alt'
    };
    const titles = {
      'route': 'Drawing Route',
      'refuge': 'Drawing Refuge Area',
      'marker': 'Adding Point Marker'
    };
    button.innerHTML = `<i class="${icons[type]}"></i>`;
    button.title = titles[type];
  }
  function handleDrawingAction(type, map) {
    // Only show a simple alert for demo (no notification system)
    let message = '';
    switch(type) {
      case 'route':
        message = 'Route drawing mode activated! Click on the map to start drawing a route.';
        break;
      case 'refuge':
        message = 'Refuge area drawing mode activated! Click on the map to start drawing a refuge area.';
        break;
      case 'marker':
        message = 'Point marker mode activated! Click on the map to add markers.';
        break;
    }
    alert(message);
    map.once('click', function(e) {
      if (type === 'marker') {
        addMarker(e.latlng, map);
      } else {
        startDrawing(type, e.latlng, map);
      }
    });
  }
  function addMarker(latlng, map) {
    const marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'custom-marker',
        html: '<i class="fas fa-map-marker-alt" style="color: #2E7D32; font-size: 24px;"></i>',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      })
    }).addTo(map);
    marker.bindPopup(`
      <div style="text-align: center;">
        <h4>Conservation Point</h4>
        <p>Lat: ${latlng.lat.toFixed(4)}</p>
        <p>Lng: ${latlng.lng.toFixed(4)}</p>
      </div>
    `);
  }
  function startDrawing(type, startLatlng, map) {
    alert(`${type} drawing started. This feature will be implemented soon.`);
  }
  const drawingControl = new DrawingControl();
  map.addControl(drawingControl);

  let currentLayer = 'satellite';
  document.getElementById('btn-layer').onclick = function() {
    if (currentLayer === 'satellite') {
      map.removeLayer(satellite);
      terrain.addTo(map);
      currentLayer = 'terrain';
    } else {
      map.removeLayer(terrain);
      satellite.addTo(map);
      currentLayer = 'satellite';
    }
  };

  document.getElementById('btn-drawing').onclick = function() {
    const drawingBtn = document.querySelector('.drawing-button');
    if (drawingBtn) {
      drawingBtn.classList.add('active');
      const panel = drawingBtn.nextElementSibling;
      if (panel) panel.style.display = 'block';
    }
  };

  document.getElementById('btn-center').onclick = function() {
    map.setView([20.5937, 78.9629], 5);
  };
}); 
