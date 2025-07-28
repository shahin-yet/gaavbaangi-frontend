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

  // Add custom polygon draw control below the layer control
  const PolygonDrawControl = L.Control.extend({
    options: {
      position: 'topleft' // same as layer control
    },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom polygon-draw-control');
      container.title = 'Draw Refuge';
      container.innerHTML = `
        <svg width="26" height="26" viewBox="0 0 26 26" style="display:block;margin:2px;" xmlns="http://www.w3.org/2000/svg">
          <polygon points="6,20 13,5 20,20" fill="#4CAF50" stroke="#333" stroke-width="2"/>
        </svg>`;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(container, 'click', function(e) {
        // Drawing logic will go here
        alert('Polygon draw button clicked!');
      });
      return container;
    }
  });
  // Add after layer control (which is already added)
  const drawControl = new PolygonDrawControl();
  map.addControl(drawControl);

  // --- Ensure draw control is below the layers control in the DOM ---
  setTimeout(() => {
    const containers = document.querySelectorAll('.leaflet-top.leaflet-left .leaflet-control');
    const layersControl = document.querySelector('.leaflet-control-layers');
    const drawButton = document.querySelector('.polygon-draw-control');
    if (layersControl && drawButton && layersControl.nextSibling !== drawButton) {
      layersControl.parentNode.insertBefore(drawButton, layersControl.nextSibling);
    }
  }, 0);
}); 
