// Single source of truth for backend API base URL

window.BACKEND_BASE_URL = 'https://gaavbaangi-backend.onrender.com';

// Map base layers for Leaflet controls
// To add another base layer, append a new object to baseLayers following this pattern:
// {
//   id: 'custom-id',
//   name: 'Friendly Name',
//   icon: 'fas fa-layer-group', // any Font Awesome class
//   url: 'https://{s}.example.com/tiles/{z}/{x}/{y}.png',
//   options: {
//     maxZoom: 18,
//     attribution: 'Tiles (c) Example Provider'
//   },
//   apiKey: 'YOUR_API_KEY', // optional: append automatically or replace {apikey} in url
//   apiKeyParam: 'apikey', // optional: query param name when no {apikey} placeholder
//   default: false // set true on exactly one layer if you want it to load first; include apiKey fields above if the layer needs auth
// }
window.MAP_LAYER_CONFIG = {
  baseLayers: [
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
  ]
};

