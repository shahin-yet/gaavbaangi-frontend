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

// Call init when the app is ready
tg.ready();
initApp(); 