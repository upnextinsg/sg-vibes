const CONFIG = {
    sheets: {
        food: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=961397190&single=true&output=csv",
        store: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=1090856077&single=true&output=csv",
        music: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=0&single=true&output=csv"
    }
};

let state = { 
    userLoc: null, 
    currentCategory: null, 
    dataCache: [],
    pointers: { food: 0, store: 0, music: 0 },
    isLocating: false // Safety lock to prevent multiple simultaneous GPS requests
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 }; // Orchard Road Fallback

// --- SECURITY: CSV PARSING ---
const secureParseCSV = (row) => {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return row.split(regex).map(cell => {
        let clean = cell.trim();
        if (clean.startsWith('"') && clean.endsWith('"')) {
            clean = clean.substring(1, clean.length - 1);
        }
        return clean.replace(/""/g, '"');
    });
};

// --- MATH: DISTANCE CALCULATION ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// --- GPS: UPDATED FOR INSTAGRAM STABILITY ---
async function getLocation() {
    if (state.userLoc && state.userLoc.lat !== SG_CENTER.lat) return state.userLoc;
    
    const getCoords = (highAcc) => {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: highAcc, // Now forces true on the first try
                timeout: 10000,              // Increased to 10 seconds for slower phones
                maximumAge: 60000            // Allows using a location from the last 60 seconds
            });
        });
    };

    try {
        // Attempt 1: High Accuracy (Real GPS)
        const pos = await getCoords(true);
        state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (err) {
        console.warn("High accuracy failed, trying standard...");
        try {
            // Attempt 2: Standard Accuracy (Cell/IP) - Good for Instagram fallback
            const pos = await getCoords(false);
            state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (finalErr) {
            console.error("GPS totally failed. Using SG Center.");
            state.userLoc = SG_CENTER;
        }
    }
    return state.userLoc;
}

// --- ENGINE: CORE LOGIC ---
async function handleAction(category) {
    if (state.isLocating) return; 

    const resultsDiv = document.getElementById("results");
    const alertDiv = document.getElementById("distance-alert");
    
    // UI Update
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');
    if (alertDiv) alertDiv.classList.add('hidden');
    
    if (state.currentCategory !== category) {
        resultsDiv.innerHTML = document.getElementById('skeleton-template').innerHTML.repeat(2);
    }

    try {
        state.isLocating = true;

        // SPEED OPTIMIZATION: Start getting location and data at the exact same time
        const locationPromise = getLocation();
        let dataPromise = null;

        if (state.currentCategory !== category) {
            dataPromise = fetch(CONFIG.sheets[category]).then(res => {
                if (!res.ok) throw new Error("Fetch failed");
                return res.text();
            });
        }

        // Wait for both tasks to finish
        const [userCoords, text] = await Promise.all([
            locationPromise,
            dataPromise ? dataPromise : Promise.resolve(null)
        ]);

        // Process data if we downloaded new data
        if (text) {
            state.currentCategory = category;
            state.dataCache = text.split("\n")
                .slice(1) 
                .map(row => row.trim())
                .filter(row => row.length > 10) 
                .map((row, idx) => ({
                    id: idx,
                    cols: secureParseCSV(row)
                }))
                .filter(item => item.cols.length >= 5);
            
            state.pointers[category] = 0; 
        }

        // 3. Calculate distances and sort
        if (userCoords && category !== 'music') {
            state.dataCache.forEach(item => {
                const lat = parseFloat(item.cols[2]);
                const lng = parseFloat(item.cols[3]);
                item.dist = (!isNaN(lat) && !isNaN(lng)) 
                    ? calculateDistance(userCoords.lat, userCoords.lng, lat, lng) : 9999;
            });

            if (state.pointers[category] === 0) {
                state.dataCache.sort((a, b) => a.dist - b.dist);
            }
        }

        // 4. Pointer System (Pagination)
        let currentIndex = state.pointers[category];

        if (currentIndex >= state.dataCache.length) {
            resultsDiv.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                    <p style="margin-bottom:15px; opacity:0.8; color:white;">✨ You've seen all current spots!</p>
                    <button onclick="resetList('${category}')" class="category-btn active" style="margin: 0 auto; width: auto; padding: 10px 20px;">🔄 Back to Start</button>
                </div>`;
            return; 
        }

        let selection = state.dataCache.slice(currentIndex, currentIndex + 2);
        state.pointers[category] += 2;

        // 5. Boundary Alerts
        if (userCoords && category !== 'music' && alertDiv) {
            const hasAnyNear = state.dataCache.some(item => item.dist <= 2);
            const currentItemsAreFar = selection.every(item => item.dist > 2);

            if (!hasAnyNear) {
                alertDiv.textContent = "📍 No options within 2km, showing others";
                alertDiv.classList.remove('hidden');
            } else if (currentItemsAreFar) {
                alertDiv.textContent = "📍 Nearby options cleared, showing further ones";
                alertDiv.classList.remove('hidden');
            }
        }

        // 6. Render the Cards
        resultsDiv.innerHTML = "";
        selection.forEach(item => {
            if (item) resultsDiv.appendChild(renderCard(item, category));
        });

    } catch (err) {
        console.error(err);
        resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white; padding: 20px;">❌ Error loading gems. Please try again.</div>`;
    } finally {
        state.isLocating = false;
    }
}

// --- UI: RENDER CARD ---
function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    const distValue = (item.dist && item.dist < 1000) ? `${item.dist.toFixed(1)}km away` : "";
    
    const imagePool = {
        food: ["1555939594-58d7cb561ad1", "1540189549336-e6e99c3679fe", "1512621776951-a57141f2eefd"],
        store: ["1441986300917-64674bd600d8", "1472851294608-062f824d29cc"],
        music: ["1511671782779-c97d3d27a1d4", "1470225620780-dba8ba36b745"]
    };

    const pool = imagePool[category] || imagePool.food;
    const imgId = pool[item.id % pool.length];
    
    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
        <div class="img-container">
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" class="card-img" alt="">
            <span class="dist-tag"></span>
        </div>
        <div class="card-content">
            <span class="category-tag"></span>
            <h3></h3>
            <p></p>
            <div class="card-footer"></div>
        </div>`;

    card.querySelector('h3').textContent = name || "Unknown";
    card.querySelector('p').textContent = desc || "No description available.";
    card.querySelector('.category-tag').textContent = type || category;
    
    const distTag = card.querySelector('.dist-tag');
    if (distValue) {
        distTag.textContent = distValue;
    } else {
        distTag.remove();
    }
    
    const footer = card.querySelector('.card-footer');
    if (mapsUrl && category !== 'music') {
        const link = document.createElement('a');
        link.href = mapsUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "btn-link";
        link.textContent = "📍 Open Google Maps ↗";
        footer.appendChild(link);
    }
    if (musicUrl && category === 'music') {
        const link = document.createElement('a');
        link.href = musicUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "btn-link";
        link.textContent = "🎵 Open Spotify ↗";
        footer.appendChild(link);
    }

    return card;
}

// --- UTILITY: RESET POINTER ---
function resetList(cat) { 
    state.pointers[cat] = 0; 
    handleAction(cat); 
}

// --- INIT: AUTO-START ON LOAD ---
window.addEventListener('DOMContentLoaded', () => {
    // 1. Show Tutorial if first time
    if (!localStorage.getItem('sgVibesTutorialSeen')) {
        const overlay = document.getElementById('tutorial-overlay');
        const closeBtn = document.getElementById('close-tutorial');
        
        overlay.classList.remove('hidden');
        
        // Close when clicking the button or anywhere on the background
        const closeTutorial = () => {
            overlay.classList.add('hidden');
            localStorage.setItem('sgVibesTutorialSeen', 'true');
        };
        
        closeBtn.addEventListener('click', closeTutorial);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTutorial();
        });
    }

    // 2. Start initial load
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 60px 20px;">
            <p style="font-size: 1.2rem; margin-bottom: 10px;">📍 Finding nearby gems...</p>
            <p style="font-size: 0.9rem; opacity: 0.7;">Please allow location access if prompted.</p>
        </div>`;
    
    handleAction('food');
});
