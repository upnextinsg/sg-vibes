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
    isLocating: false // Safety lock
};

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

// --- GPS: FAIL-SAFE LOCATION ---
const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

async function getLocation() {
    if (state.userLoc) return state.userLoc;
    
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                resolve(state.userLoc);
            },
            (err) => {
                console.warn("Location error, using fallback:", err.message);
                state.userLoc = SG_CENTER; 
                resolve(SG_CENTER);
            }, 
            { 
                enableHighAccuracy: false, // Prevents Instagram from crashing
                timeout: 10000,            // 10 seconds to allow for popups
                maximumAge: Infinity 
            } 
        );
    });
}

// --- ENGINE: CORE LOGIC ---
async function handleAction(category) {
    // 1. Prevent double-clicks from crashing the app
    if (state.isLocating) {
        console.log("Currently loading, please wait...");
        return; 
    }

    const resultsDiv = document.getElementById("results");
    const alertDiv = document.getElementById("distance-alert");
    
    // SAFE DOM SELECTION: The `?` prevents crashes if the HTML ID doesn't exactly match
    const clickedBtn = document.getElementById(`${category}Btn`);
    
    // UI Update Safely
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
    if (alertDiv) alertDiv.classList.add('hidden');

    let originalText = clickedBtn ? clickedBtn.innerHTML : category;

    // 2. Apply Loading Lock
    if (!state.userLoc) {
        state.isLocating = true;
        if (clickedBtn) clickedBtn.innerHTML = `<span class="icon">⏳</span> Waiting...`;
        if (resultsDiv) resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white; padding: 40px;">📍 Getting location (check for prompt)...</div>`;
    }

    try {
        // 3. Await Location
        const userCoords = await getLocation();

        // 4. Fetch data if category changed
        if (state.currentCategory !== category) {
            
            // Safe skeleton loading
            const skeleton = document.getElementById('skeleton-template');
            if (resultsDiv && skeleton) {
                resultsDiv.innerHTML = skeleton.innerHTML.repeat(2);
            } else if (resultsDiv) {
                resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white;">Loading data...</div>`;
            }

            state.currentCategory = category;
            
            const res = await fetch(CONFIG.sheets[category]);
            if (!res.ok) throw new Error("Fetch failed");
            const text = await res.text();
            
            state.dataCache = text.split("\n")
                .slice(1) 
                .map(row => row.trim())
                .filter(row => row.length > 10) 
                .map((row, idx) => ({ id: idx, cols: secureParseCSV(row) }))
                .filter(item => item.cols.length >= 5);
            
            state.pointers[category] = 0; 
        }

        // 5. Calculate distances securely
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

        // 6. Pagination & Alert Check
        let currentIndex = state.pointers[category];
        if (currentIndex >= state.dataCache.length) {
            if (resultsDiv) {
                resultsDiv.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                        <p style="margin-bottom:15px; opacity:0.8; color:white;">✨ You've seen all current spots!</p>
                        <button onclick="resetList('${category}')" class="category-btn active" style="margin: 0 auto; width: auto; padding: 10px 20px;">🔄 Back to Start</button>
                    </div>`;
            }
            return; 
        }

        let selection = state.dataCache.slice(currentIndex, currentIndex + 2);
        state.pointers[category] += 2;

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

        // 7. Render
        if (resultsDiv) {
            resultsDiv.innerHTML = "";
            selection.forEach(item => {
                if (item) resultsDiv.appendChild(renderCard(item, category));
            });
        }

    } catch (err) {
        console.error("Critical Application Error:", err);
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white; padding: 20px;">❌ Error loading data. Please try again.</div>`;
        }
    } finally {
        // 8. THE GUARANTEED UNLOCK: No matter what breaks, the app unlocks itself here.
        state.isLocating = false;
        if (clickedBtn && clickedBtn.innerHTML.includes("Waiting")) {
            clickedBtn.innerHTML = originalText;
        }
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
    // Restored the automatic load so the screen isn't blank on startup
    handleAction('food');
});
