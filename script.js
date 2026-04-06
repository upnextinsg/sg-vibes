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
    isLocating: false,
    locationStatus: 'idle' 
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 };


// -----------------------------
// INSTAGRAM DETECTION
// -----------------------------
function isInstagramBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Instagram/i.test(ua);
}


// -----------------------------
// CSV PARSING
// -----------------------------
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


// -----------------------------
// DISTANCE CALCULATION
// -----------------------------
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}


// -----------------------------
// IMPROVED GEOLOCATION
// -----------------------------
async function getLocation() {
    if (state.locationStatus === 'resolved' || state.locationStatus === 'requesting') {
        return state.userLoc || SG_CENTER;
    }

    state.locationStatus = 'requesting';

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            fallbackLocation(resolve, "Geolocation not supported");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                };
                state.locationStatus = 'resolved';
                resolve(state.userLoc);
            },
            (error) => {
                fallbackLocation(resolve, error.message);
            },
            {
                enableHighAccuracy: true,   // ✅ FIXED
                timeout: 15000,             // ✅ LONGER TIMEOUT
                maximumAge: 0               // ✅ NO CACHED LOCATION
            }
        );
    });
}


// -----------------------------
// FALLBACK HANDLER
// -----------------------------
function fallbackLocation(resolve, reason) {
    console.warn("Location fallback:", reason);

    const alertBox = document.getElementById("distance-alert");
    if (alertBox) {
        alertBox.classList.remove("hidden");

        let message = `
            📍 Unable to get precise location.<br>
            Showing general nearby results.<br><br>
        `;

        if (isInstagramBrowser()) {
            message += `👉 For accurate results, tap <b>•••/⋮</b> → <b>Open in your Browser</b>`;
        } else {
            message += `👉 Please enable location permissions`;
        }

        alertBox.innerHTML = message;
    }

    state.userLoc = SG_CENTER;
    state.locationStatus = 'resolved';
    resolve(SG_CENTER);
}


// -----------------------------
// MAIN ENGINE
// -----------------------------
async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");

    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');

    // Instagram warning (non-blocking)
    if (isInstagramBrowser()) {
        const alertBox = document.getElementById("distance-alert");
        if (alertBox) {
            alertBox.classList.remove("hidden");
            alertBox.innerHTML = `
                ⚠️ Instagram may show inaccurate location.<br>
                Tap <b>•••</b> → <b>Open in Browser</b> for best results.
            `;
        }
    }

    if (state.currentCategory !== category) {
        resultsDiv.innerHTML = document.getElementById('skeleton-template').innerHTML.repeat(2);
    }

    try {
        state.isLocating = true;

        const [userCoords, text] = await Promise.all([
            getLocation(),
            state.currentCategory !== category 
                ? fetch(CONFIG.sheets[category]).then(r => r.text()) 
                : Promise.resolve(null)
        ]);

        if (text) {
            state.currentCategory = category;
            state.dataCache = text.split("\n").slice(1)
                .map((row, index) => ({ id: index, cols: secureParseCSV(row.trim()) }))
                .filter(item => item.cols.length >= 5);

            state.pointers[category] = 0; 
        }

        if (category !== 'music') {
            state.dataCache.forEach(item => {
                const lat = parseFloat(item.cols[2]);
                const lng = parseFloat(item.cols[3]);
                item.dist = calculateDistance(userCoords.lat, userCoords.lng, lat, lng);
            });

            if (state.pointers[category] === 0) {
                state.dataCache.sort((a, b) => a.dist - b.dist);
            }
        }

        let selection = state.dataCache.slice(
            state.pointers[category],
            state.pointers[category] + 2
        );

        state.pointers[category] += 2;

        if (selection.length === 0 && state.dataCache.length > 0) {
            resultsDiv.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;">
                    <button onclick="resetList('${category}')" 
                        class="category-btn active" 
                        style="margin: 0 auto; width: auto; padding: 10px 20px;">
                        🔄 Start Over
                    </button>
                </div>`;
        } else {
            resultsDiv.innerHTML = "";
            selection.forEach(item => resultsDiv.appendChild(renderCard(item, category)));
        }

    } catch (e) {
        console.error("Fetch error:", e);
    } finally {
        state.isLocating = false;
    }
}


// -----------------------------
// CARD RENDER
// -----------------------------
function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;

    const distValue = (item.dist && item.dist < 1000)
        ? `${item.dist.toFixed(1)}km away`
        : "";

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
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" class="card-img">
            <span class="dist-tag"></span>
        </div>
        <div class="card-content">
            <span class="category-tag"></span>
            <h3></h3>
            <p></p>
            <div class="card-footer"></div>
        </div>`;

    card.querySelector('h3').textContent = name || "Local Spot";
    card.querySelector('p').textContent = desc || "Tap below for details";
    card.querySelector('.category-tag').textContent = type || category;

    const distTag = card.querySelector('.dist-tag');
    if (distValue && category !== 'music') {
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


// -----------------------------
// RESET
// -----------------------------
function resetList(cat) {
    state.pointers[cat] = 0;
    handleAction(cat);
}


// -----------------------------
// OPTIONAL MANUAL RETRY
// -----------------------------
function retryLocation() {
    state.locationStatus = 'idle';
    state.userLoc = null;
    handleAction(state.currentCategory || 'food');
}


// -----------------------------
// INIT
// -----------------------------
window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');

    overlay.classList.remove('hidden');

    closeBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
    });

    handleAction('food');
});
