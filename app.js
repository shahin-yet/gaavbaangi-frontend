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
      button.innerHTML = '';
      
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
      
      // Add event listeners for hover behavior (like layer control)
      L.DomEvent.disableClickPropagation(container);
      
      // Show panel on mouse enter
      L.DomEvent.on(container, 'mouseenter', function(e) {
        panel.style.display = 'block';
        button.classList.add('active');
      });
      
      // Hide panel on mouse leave
      L.DomEvent.on(container, 'mouseleave', function(e) {
        panel.style.display = 'none';
        button.classList.remove('active');
      });
      
      // Also add click handler as fallback
      L.DomEvent.on(button, 'click', function(e) {
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        button.classList.toggle('active', !isVisible);
      });
      
      // Handle option selection
      L.DomEvent.on(panel, 'click', function(e) {
        const option = e.target.closest('.drawing-option');
        if (option) {
          const type = option.dataset.type;
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          
          // Update button appearance based on selection
          if (type === 'route') {
            button.title = 'Drawing Route';
          } else {
            button.title = 'Drawing Refuge';
          }
          
          // Panel will hide automatically on mouse leave
          
          // Handle the drawing action
          handleDrawingAction(type);
        }
      });
      
      // No need for click outside handler with hover behavior
      
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
