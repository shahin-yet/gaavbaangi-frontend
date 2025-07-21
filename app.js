// Initialize Telegram WebApp
const tg = window.Telegram.WebApp;

// Enable closing confirmation
tg.enableClosingConfirmation();

// Set theme colors
document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color);
document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color);
document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color);
document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color);
document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color);
document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color);

// Backend API URL from environment variable or fallback
const API_URL = process.env.API_URL || 'https://your-render-backend-url.onrender.com';

// Initialize the app
async function initApp() {
    try {
        // Send init data to backend
        const response = await fetch(`${API_URL}/api/init-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                initData: tg.initData,
                initDataUnsafe: tg.initDataUnsafe
            })
        });

        const data = await response.json();
        console.log('Backend response:', data);
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

// Add MapLibre GL JS and KML support
// Load MapLibre GL JS dynamically
const maplibreScript = document.createElement('script');
maplibreScript.src = 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js';
maplibreScript.onload = () => initMap();
document.head.appendChild(maplibreScript);

// Load MapLibre GL CSS
const maplibreCSS = document.createElement('link');
maplibreCSS.rel = 'stylesheet';
maplibreCSS.href = 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css';
document.head.appendChild(maplibreCSS);

// Load togeojson for KML parsing
const togeojsonScript = document.createElement('script');
togeojsonScript.src = 'https://unpkg.com/togeojson@0.16.0/dist/togeojson.umd.js';
document.head.appendChild(togeojsonScript);

function initMap() {
    if (!window.maplibregl) {
        setTimeout(initMap, 200); // Wait for script to load
        return;
    }
    const map = new maplibregl.Map({
        container: 'map',
        style: `https://api.maptiler.com/maps/streets/style.json?key=8UlF6jTmzfAVZUz8WjbH`,
        center: [51.389, 35.689], // Default: Tehran
        zoom: 10
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    window._map = map; // For debugging

    // KML upload handler
    document.getElementById('kml-upload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            const kmlText = event.target.result;
            const parser = new DOMParser();
            const kmlDom = parser.parseFromString(kmlText, 'text/xml');
            // Wait for toGeoJSON to load
            function tryAddKML() {
                if (!window.toGeoJSON) {
                    setTimeout(tryAddKML, 100);
                    return;
                }
                const geojson = toGeoJSON.kml(kmlDom);
                if (map.getSource('kml')) {
                    map.removeLayer('kml');
                    map.removeSource('kml');
                }
                map.addSource('kml', {
                    type: 'geojson',
                    data: geojson
                });
                map.addLayer({
                    id: 'kml',
                    type: 'line',
                    source: 'kml',
                    paint: {
                        'line-color': '#ff6600',
                        'line-width': 4
                    }
                });
                // Fit map to KML bounds
                const coords = geojson.features.flatMap(f => f.geometry.coordinates.flat(1));
                if (coords.length > 0) {
                    const lons = coords.map(c => c[0]);
                    const lats = coords.map(c => c[1]);
                    const bounds = [
                        [Math.min(...lons), Math.min(...lats)],
                        [Math.max(...lons), Math.max(...lats)]
                    ];
                    map.fitBounds(bounds, {padding: 40});
                }
                document.getElementById('map-info').textContent = 'KML track loaded!';
            }
            tryAddKML();
        };
        reader.readAsText(file);
    });
}

// Call init when the app is ready
tg.ready();
initApp(); 
