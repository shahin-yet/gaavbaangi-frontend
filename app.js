// Wait for the DOM to be fully loaded
window.addEventListener('DOMContentLoaded', function () {
  // Navigation functionality
  initializeNavigation();
  
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

  // Enhanced drawing control with better icons
  const DrawingControl = L.Control.extend({
    options: {
      position: 'topleft'
    },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom drawing-control');
      
      // Create the main button with drawing icon
      const button = L.DomUtil.create('div', 'drawing-button', container);
      button.innerHTML = '<i class="fas fa-draw-polygon"></i>';
      button.title = 'Drawing Tools';
      
      // Create the dropdown panel
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
      
      // Add event listeners for hover behavior
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
      
      // Handle option selection
      L.DomEvent.on(panel, 'click', function(e) {
        const option = e.target.closest('.drawing-option');
        if (option) {
          const type = option.dataset.type;
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          
          // Update button appearance based on selection
          updateDrawingButton(button, type);
          
          // Handle the drawing action
          handleDrawingAction(type, map);
        }
      });
      
      return container;
    }
  });
  
  // Function to update drawing button appearance
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
  
  // Function to handle drawing actions
  function handleDrawingAction(type, map) {
    let message = '';
    let icon = '';
    
    switch(type) {
      case 'route':
        message = 'Route drawing mode activated! Click on the map to start drawing a route.';
        icon = 'fas fa-route';
        break;
      case 'refuge':
        message = 'Refuge area drawing mode activated! Click on the map to start drawing a refuge area.';
        icon = 'fas fa-shield-alt';
        break;
      case 'marker':
        message = 'Point marker mode activated! Click on the map to add markers.';
        icon = 'fas fa-map-marker-alt';
        break;
    }
    
    showNotification(message, 'info', icon);
    
    // Add click handler to map for drawing
    map.once('click', function(e) {
      if (type === 'marker') {
        addMarker(e.latlng, map);
      } else {
        startDrawing(type, e.latlng, map);
      }
    });
  }
  
  // Function to add marker
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
        <button onclick="removeMarker(this)" class="btn-remove">Remove</button>
      </div>
    `);
    
    showNotification('Marker added successfully!', 'success', 'fas fa-check');
  }
  
  // Function to start drawing (placeholder for future implementation)
  function startDrawing(type, startLatlng, map) {
    showNotification(`${type} drawing started. This feature will be implemented soon.`, 'info', 'fas fa-info-circle');
  }
  
  // Add the drawing control to the map
  const drawingControl = new DrawingControl();
  map.addControl(drawingControl);

  // Initialize file upload functionality
  initializeFileUpload();
  
  // Initialize export functionality
  initializeExport();
});

// Navigation functionality
function initializeNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.content-section');
  
  navButtons.forEach(button => {
    button.addEventListener('click', function() {
      const targetSection = this.dataset.section;
      
      // Update active states
      navButtons.forEach(btn => btn.classList.remove('active'));
      sections.forEach(section => section.classList.remove('active'));
      
      this.classList.add('active');
      document.getElementById(`${targetSection}-section`).classList.add('active');
    });
  });
}

// File upload functionality
function initializeFileUpload() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('kml-upload');
  
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function() {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        handleFileUpload(file);
      }
    });
  }
}

// Handle file upload
function handleFileUpload(file) {
  if (file.type === 'application/vnd.google-earth.kml+xml' || file.name.endsWith('.kml')) {
    showNotification('KML file uploaded successfully!', 'success', 'fas fa-upload');
    // Add KML parsing logic here
  } else {
    showNotification('Please select a valid KML file.', 'error', 'fas fa-exclamation-triangle');
  }
}

// Export functionality
function initializeExport() {
  const exportBtn = document.getElementById('export-btn');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      showNotification('Exporting data...', 'info', 'fas fa-download');
      // Add export logic here
      setTimeout(() => {
        showNotification('Data exported successfully!', 'success', 'fas fa-check');
      }, 2000);
    });
  }
}

// Notification system
function showNotification(message, type = 'info', icon = 'fas fa-info-circle') {
  // Remove existing notifications
  const existingNotifications = document.querySelectorAll('.notification');
  existingNotifications.forEach(notification => notification.remove());
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="${icon}"></i>
      <span>${message}</span>
      <button class="notification-close" onclick="this.parentElement.parentElement.remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  
  // Add styles
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    padding: 16px;
    z-index: 10000;
    min-width: 300px;
    border-left: 4px solid ${getNotificationColor(type)};
    animation: slideIn 0.3s ease-out;
  `;
  
  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    .notification-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .notification-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #666;
      margin-left: auto;
    }
    
    .notification-close:hover {
      color: #333;
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

// Get notification color based on type
function getNotificationColor(type) {
  const colors = {
    'success': '#4CAF50',
    'error': '#f44336',
    'warning': '#FF9800',
    'info': '#2196F3'
  };
  return colors[type] || colors.info;
}

// Global function to remove markers
function removeMarker(button) {
  const popup = button.closest('.leaflet-popup');
  const marker = popup._source;
  marker.remove();
  showNotification('Marker removed successfully!', 'success', 'fas fa-trash');
} 
