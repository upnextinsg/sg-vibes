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

function isInstagramBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Instagram/i.test(ua);
}

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

async function getLocation() {
    if (state.locationStatus === 'resolved' || state.locationStatus === 'requesting') {
        return state.userLoc || SG_CENTER;
    }
    state.locationStatus = 'requesting';
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            fallbackLocation(resolve, "Not supported");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                state.locationStatus = 'resolved';
                resolve(state.userLoc);
            },
            (error) => fallbackLocation(resolve, error.message),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

function fallbackLocation(resolve, reason) {
    const alertBox = document.getElementById("distance-alert");
    if (alertBox) {
        alertBox.classList.remove("hidden");
        alertBox.innerHTML = `📍 Location unavailable. Showing general results.`;
    }
    state.userLoc = SG_CENTER;
    state.locationStatus = 'resolved';
    resolve(SG_CENTER);
}

async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');

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

        let selection = state.dataCache.slice(state.pointers[category], state.pointers[category] + 2);
        state.pointers[category] += 2;

        if (selection.length === 0 && state.dataCache.length > 0) {
            resultsDiv.innerHTML = `<button onclick="resetList('${category}')" class="category-btn active" style="grid-column:1/-1; margin:20px auto;">🔄 Start Over</button>`;
        } else {
            resultsDiv.innerHTML = "";
            selection.forEach(item => resultsDiv.appendChild(renderCard(item, category)));
        }
    } catch (e) {
        console.error(e);
    } finally {
        state.isLocating = false;
    }
}

function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    const imagePool = {
        food: ["1555939594-58d7cb561ad1", "1540189549336-e6e99c3679fe"],
        store: ["1441986300917-64674bd600d8", "1472851294608-062f824d29cc"],
        music: ["1511671782779-c97d3d27a1d4"]
    };
    const pool = imagePool[category] || imagePool.food;
    const imgId = pool[item.id % pool.length];

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <div class="img-container">
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" class="card-img">
            <span class="dist-tag">${item.dist ? item.dist.toFixed(1)+'km' : ''}</span>
        </div>
        <div class="card-content">
            <span class="category-tag">${type || category}</span>
            <h3>${name}</h3>
            <p>${desc}</p>
            <div class="card-footer">
                <a href="${category === 'music' ? musicUrl : mapsUrl}" target="_blank" class="btn-link">
                    ${category === 'music' ? '🎵 Open Spotify' : '📍 Open Maps'}
                </a>
            </div>
        </div>`;
    return card;
}

function resetList(cat) {
    state.pointers[cat] = 0;
    handleAction(cat);
}

// --- INIT (FIXED) ---
window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');

    // 1. Show the overlay immediately
    overlay.classList.remove('hidden');

    // 2. ONLY start the app after the user interacts
    closeBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        handleAction('food'); // Initial load triggered by user click
    });
});
