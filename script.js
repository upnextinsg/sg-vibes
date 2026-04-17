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
    locationStatus: 'idle',
    appPhase: 'BOOT',
    hasUserInteracted: false
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

// --- UI ENHANCEMENTS ---

function toggleLoader(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
    }
}

function showHeroOverlay() {
    // Remove existing if any
    const existing = document.querySelector('.hero-transition');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'hero-transition';
    overlay.innerHTML = `
        <div class="hero-card">
            <div class="hero-icon">🇸🇬</div>
            <h2>You're a Hero!</h2>
            <p>Opening now… thanks for supporting local</p>
            <div class="hero-loader"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // The overlay stays visible so when the user comes back from Maps, 
    // they still see the "Thank You" state before it fades.
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 800);
    }, 4800);
}

async function shareSpot(name, specificUrl) {
    const shareData = {
        title: name,
        text: `Supporting Local: Check out ${name}! Found on SG Vibes. 🇸🇬`,
        url: specificUrl 
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(specificUrl);
            alert("Link copied! Share it to support this local gem.");
        }
    } catch (err) { console.log('Share aborted'); }
}

// --- HELPERS & GEOLOCATION ---

function isInstagramBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Instagram/i.test(ua);
}

if (isInstagramBrowser() && !sessionStorage.getItem('igReloaded')) {
    sessionStorage.setItem('igReloaded', 'true');
    setTimeout(() => {
        window.location.href = window.location.href;
    }, 300);
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
    if (state.locationStatus === 'resolved') return state.userLoc || SG_CENTER;
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
                // Hide alert if location is now found
                document.getElementById("distance-alert")?.classList.add("hidden");
                resolve(state.userLoc);
            },
            (error) => fallbackLocation(resolve, error.message),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
}

function fallbackLocation(resolve, reason) {
    const alertBox = document.getElementById("distance-alert");
    if (alertBox) {
        alertBox.classList.remove("hidden");
        let message = `📍 Unable to get precise location. Showing results across Singapore.`;
        if (isInstagramBrowser()) message += `<br>👉 Tap <b>•••/⋮</b> → <b>Open in Browser</b>`;
        else {message += `👉 For better accuracy, turn on location and refresh.`;}
        alertBox.innerHTML = message;
    }
    state.userLoc = SG_CENTER;
    state.locationStatus = 'resolved';
    resolve(SG_CENTER);
}

// --- MAIN ACTION HANDLER ---

async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");
    const buttonGroup = document.querySelector('.button-group');

if (buttonGroup && !buttonGroup.classList.contains('sticky-active')) {
    buttonGroup.classList.add('sticky-active');

    // ONLY scroll AFTER first user interaction
    if (!state.hasUserInteracted) {
        state.hasUserInteracted = true;

        requestAnimationFrame(() => {
            setTimeout(() => {
                const yOffset = -10;
                const y = buttonGroup.getBoundingClientRect().top + window.pageYOffset + yOffset;

                window.scrollTo({
                    top: y,
                    behavior: 'smooth'
                });
            }, 80); // small delay prevents auto-scroll glitch
        });
    }
}
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');

    toggleLoader(true);

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
        
        if (selection.length === 1 && state.dataCache.length > 1) {
             selection.push(state.dataCache[0]); 
        }

        state.pointers[category] += 2;

        if (selection.length === 0 && state.dataCache.length > 0) {
            resultsDiv.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;">
                    <button onclick="resetList('${category}')" class="category-btn active" style="margin: 0 auto; width: auto; padding: 12px 24px;">
                        🔄 Start Over
                    </button>
                </div>`;
        } else {
            resultsDiv.innerHTML = "";
            selection.forEach(item => resultsDiv.appendChild(renderCard(item, category)));
            
            // Logic Fix: Ensure error visibility isn't scrolled past
            const alertBox = document.getElementById("distance-alert");
            if (alertBox && !alertBox.classList.contains("hidden")) {
                window.scrollTo({ top: alertBox.offsetTop - 100, behavior: 'smooth' });
            } else {
                window.scrollTo({ top: resultsDiv.offsetTop - 120, behavior: 'smooth' });
            }
        }
    } catch (err) {
        console.error("Action Error:", err);
    } finally {
        state.isLocating = false;
        toggleLoader(false);
    }
}

// --- RENDERING LOGIC ---

function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    const activeCat = category.toLowerCase().trim();

    // RESTORED: Your original rotating image arrays
    const imgMap = {
        food: ["1555939594-58d7cb561ad1", "1540189549336-e6e99c3679fe", "1512621776951-a57141f2eefd"],
        store: ["1441986300917-64674bd600d8", "1472851294608-062f824d29cc"],
        music: ["1511671782779-c97d3d27a1d4", "1470225620780-dba8ba36b745"]
    };

    // Logic: Cycle through the array based on the item's unique index
    const categoryImages = imgMap[activeCat] || imgMap.food;
    const imgId = categoryImages[item.id % categoryImages.length];

    const card = document.createElement("div");
    card.className = "card";
    
    const distText = item.dist ? `${item.dist.toFixed(1)}km away` : "Discover local";

    card.innerHTML = `
        <div class="img-container">
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" 
                 class="card-img" alt="${name}" loading="lazy">
            <span class="dist-tag">${distText}</span>
        </div>
        <div class="card-content">
            <span class="category-tag">${type || category}</span>
            <h3>${name || "Local Spot"}</h3>
            <p>${desc || "Tap below for details"}</p>
            <div class="card-footer" style="display:flex; gap:8px; margin-top:auto;"></div>
        </div>`;

    const footer = card.querySelector('.card-footer');
    const targetUrl = (activeCat === 'music' && musicUrl) ? musicUrl : (mapsUrl || "#");
    
    // Primary Action (Maps/Spotify)
    const mainBtn = document.createElement('button');
    mainBtn.className = "btn-link";
    mainBtn.style.flex = "2";
    mainBtn.style.background = "var(--accent)";
    mainBtn.style.color = "white";
    mainBtn.style.padding = "12px";
    mainBtn.style.borderRadius = "12px";
    mainBtn.style.fontWeight = "700";
    mainBtn.textContent = (activeCat === 'music') ? "🎵 Open Spotify" : "📍 Open Google Maps";
    
   mainBtn.onclick = () => {
    if (!targetUrl || targetUrl === "#") {
        alert("Link unavailable.");
        return;
    }

    // ✅ Show hero first
    showHeroOverlay();

    // ✅ Then navigate in SAME TAB
    setTimeout(() => {
        window.location.href = targetUrl;
    }, 1400); // 1.2s = visible but not annoying
};
    
    const shareBtn = document.createElement('button');
    shareBtn.className = "btn-link btn-share-secondary";
    shareBtn.style.flex = "1";
    shareBtn.style.padding = "12px";
    shareBtn.style.borderRadius = "12px";
    shareBtn.style.fontWeight = "700";
    shareBtn.innerHTML = "🔗 Share";
    shareBtn.onclick = (e) => {
        e.stopPropagation();
        shareSpot(name, targetUrl);
    };
    
    footer.appendChild(mainBtn);
    footer.appendChild(shareBtn);

    return card;
}

function resetList(cat) {
    state.pointers[cat] = 0;
    handleAction(cat);
}

function shareApp() {
    const appData = {
        title: 'SG Vibes',
        text: 'Discover the best local food, shops, and music in Singapore!',
        url: 'https://upnextinsg.github.io/sg-vibes/'
    };
    if (navigator.share) {
        navigator.share(appData);
    } else {
        navigator.clipboard.writeText(appData.url);
        alert("App link copied! Spread the vibes.");
    }
}

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');

    let hasStarted = false;

    function startApp() {
        if (hasStarted) return;
        hasStarted = true;
        handleAction('food');
    }

    if (overlay) {
        overlay.classList.remove('hidden');

        closeBtn?.addEventListener('click', () => {
        overlay.classList.add('hidden');
        state.appPhase = 'READY';
        startApp();
    });

        // 🔥 FAILSAFE: if anything breaks, auto-start after 1.5s
        setTimeout(() => {
            state.appPhase = 'READY';
            startApp();
        }, 1500);
    } else {
        startApp();
    }
});
