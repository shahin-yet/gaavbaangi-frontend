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

  // Do not add both layers to the map by default
  // Only add one, the other will be available in the control
  satellite.addTo(map);

  // Layer control
  const baseMaps = {
    "Satellite": satellite,
    "Terrain": terrain
  };
  L.control.layers(baseMaps).addTo(map);

  // Custom drawing control with selectable options
  const DrawingControl = L.Control.extend({
    options: {
      position: 'topleft'
    },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom drawing-control');
      
      // Create the main button with drawing icon
      const button = L.DomUtil.create('div', 'drawing-button', container);
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="3,6 5,6 5,20 19,20 19,10 9,10 9,6" fill="#666"/>
          <line x1="9" y1="6" x2="9" y2="2"/>
          <line x1="15" y1="6" x2="15" y2="2"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
        </svg>
      `;
      button.title = 'Drawing Tools';
      
      // Create the dropdown panel
      const panel = L.DomUtil.create('div', 'drawing-panel', container);
      panel.style.display = 'none';
      panel.innerHTML = `
        <div class="drawing-option" data-type="route">
          <input type="radio" name="drawing-type" id="route-option" value="route">
          <label for="route-option">Route</label>
        </div>
        <div class="drawing-option" data-type="refuge">
          <input type="radio" name="drawing-type" id="refuge-option" value="refuge">
          <label for="refuge-option">Refuge</label>
        </div>
      `;
      
      // Prevent map clicks from interfering
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      
      // Toggle panel on button click (like layer control)
      L.DomEvent.on(button, 'click', function(e) {
        e.stopPropagation();
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        button.classList.toggle('active', !isVisible);
      });
      
      // Handle option selection
      L.DomEvent.on(panel, 'click', function(e) {
        e.stopPropagation();
        const option = e.target.closest('.drawing-option');
        if (option) {
          const type = option.dataset.type;
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          
          // Update button appearance based on selection
          const svg = button.querySelector('svg polygon');
          if (type === 'route') {
            svg.setAttribute('fill', '#2196F3'); // Blue for route
            button.title = 'Drawing Route';
          } else {
            svg.setAttribute('fill', '#4CAF50'); // Green for refuge
            button.title = 'Drawing Refuge';
          }
          
          // Handle the drawing action
          handleDrawingAction(type);
        }
      });
      
      // Close panel when clicking outside
      L.DomEvent.on(document, 'click', function(e) {
        if (!container.contains(e.target)) {
          panel.style.display = 'none';
          button.classList.remove('active');
        }
      });
      
      return container;
    }
  });
  
  // Function to handle drawing actions
  function handleDrawingAction(type) {
    if (type === 'route') {
      alert('Route drawing mode activated! Click on the map to start drawing a route.');
      // Add route drawing logic here
    } else if (type === 'refuge') {
      alert('Refuge drawing mode activated! Click on the map to start drawing a refuge area.');
      // Add refuge drawing logic here
    }
  }
  
  // Add the drawing control to the map
  const drawingControl = new DrawingControl();
  map.addControl(drawingControl);

  // --- Ensure drawing control is below the layers control in the DOM ---
  setTimeout(() => {
    const containers = document.querySelectorAll('.leaflet-top.leaflet-left .leaflet-control');
    const layersControl = document.querySelector('.leaflet-control-layers');
    const drawButton = document.querySelector('.drawing-control');
    if (layersControl && drawButton && layersControl.nextSibling !== drawButton) {
      layersControl.parentNode.insertBefore(drawButton, layersControl.nextSibling);
    }
  }, 0);
}); 
