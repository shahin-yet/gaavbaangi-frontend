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

  // Add default layer
  satellite.addTo(map);

  // Layer control
  const baseMaps = {
    "Satellite": satellite,
    "Terrain": terrain
  };
  L.control.layers(baseMaps).addTo(map);

  // Refuge polygon drawing logic
  let drawing = false;
  let polygonPoints = [];
  let polygonLayer = null;
  let markerLayers = [];

  const drawBtn = document.getElementById('draw-refuge-btn');
  const finishBtn = document.getElementById('finish-polygon-btn');
  const nameInput = document.getElementById('refuge-name');

  drawBtn.addEventListener('click', function () {
    drawing = true;
    polygonPoints = [];
    if (polygonLayer) {
      map.removeLayer(polygonLayer);
      polygonLayer = null;
    }
    markerLayers.forEach(m => map.removeLayer(m));
    markerLayers = [];
    nameInput.value = '';
    nameInput.style.display = 'inline-block';
    finishBtn.style.display = 'inline-block';
    drawBtn.disabled = true;
    map.getContainer().style.cursor = 'crosshair';
  });

  map.on('click', function (e) {
    if (!drawing) return;
    const latlng = e.latlng;
    polygonPoints.push([latlng.lat, latlng.lng]);
    const marker = L.marker(latlng, { draggable: false });
    marker.addTo(map);
    markerLayers.push(marker);
    if (polygonLayer) {
      map.removeLayer(polygonLayer);
    }
    if (polygonPoints.length > 1) {
      polygonLayer = L.polygon(polygonPoints, { color: '#4CAF50', fillOpacity: 0.3 });
      polygonLayer.addTo(map);
    }
  });

  finishBtn.addEventListener('click', function () {
    if (polygonPoints.length < 3) {
      alert('A refuge must have at least 3 points.');
      return;
    }
    const name = nameInput.value.trim() || 'Unnamed Refuge';
    if (polygonLayer) {
      polygonLayer.bindTooltip(name, { permanent: true, direction: 'center', className: 'refuge-label' }).openTooltip();
    }
    drawing = false;
    drawBtn.disabled = false;
    nameInput.style.display = 'none';
    finishBtn.style.display = 'none';
    map.getContainer().style.cursor = '';
    // Optionally, clear marker pins after finishing
    markerLayers.forEach(m => map.removeLayer(m));
    markerLayers = [];
  });
}); 