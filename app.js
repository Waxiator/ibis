document.addEventListener('DOMContentLoaded', () => {

    // --- SEKCJA KONFIGURACJI I REFERENCJI DO ELEMENTÓW ---
    const ORS_API_KEY = '5b3ce3597851110001cf6248a991e35a46bb42e081be692630cc09ac';

    // Ekrany
    const setupScreen = document.getElementById('setup-screen');
    const mapScreen = document.getElementById('map-screen');

    // Elementy ekranu ustawień
    const ibisLine1 = document.getElementById('ibis-line-1');
    const ibisLine2 = document.getElementById('ibis-line-2');
    const keypad = document.getElementById('keypad');

    // Elementy ekranu mapy
    const backButton = document.getElementById('back-button');
    const nextStopNameEl = document.getElementById('next-stop-name');
    const distanceToStopEl = document.getElementById('distance-to-stop');
    const upcomingStopNameEl = document.getElementById('upcoming-stop-name');

    // Zmienne stanu aplikacji
    let allData = null;
    let currentSetupState = 'ENTERING_LINE';
    let inputBuffer = "";
    let selectedLine = null;
    let watchId = null;

    // Zmienne mapy i warstw
    let map = null;
    let userDot, userAccuracyCircle, stopMarker, routeToNextStopPolyline, fullRoutePolyline;
    let currentStops = [];
    let currentStopIndex = -1;
    
    // --- GŁÓWNA LOGIKA APLIKACJI ---

    fetch('moje_trasy.json')
        .then(response => response.json())
        .then(data => { allData = data; });

    keypad.addEventListener('click', (e) => {
        if (!e.target.classList.contains('keypad-btn')) return;
        const key = e.target.textContent;
        if (key === 'C') resetSetup();
        else if (key === 'OK') handleOkClick();
        else { inputBuffer += key; updateDisplay(); }
    });
    
    backButton.addEventListener('click', () => {
        mapScreen.classList.add('hidden');
        setupScreen.classList.remove('hidden');
        resetSetup();
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (map) {
            if (routeToNextStopPolyline) map.removeLayer(routeToNextStopPolyline);
            if (fullRoutePolyline) map.removeLayer(fullRoutePolyline);
        }
    });

    // --- FUNKCJE ZARZĄDZAJĄCE STANEM USTAWIEŃ ---

    function resetSetup() {
        currentSetupState = 'ENTERING_LINE';
        inputBuffer = "";
        selectedLine = null;
        updateDisplay();
    }

    function updateDisplay() {
        if (currentSetupState === 'ENTERING_LINE') {
            ibisLine1.textContent = `LINIA: ${inputBuffer || '___'}`;
            ibisLine2.textContent = 'PODAJ NR LINII I ZATWIERDŹ';
        } else if (currentSetupState === 'CHOOSING_DIRECTION') {
            ibisLine1.textContent = `LINIA: ${selectedLine.numer}`;
            const directionsText = selectedLine.kierunki.map((dir, i) => `${i + 1}. ${dir.nazwa}`).join('\n');
            ibisLine2.textContent = `WYBIERZ KIERUNEK:\n${directionsText}`;
        }
    }

    function handleOkClick() {
        if (currentSetupState === 'ENTERING_LINE') {
            selectedLine = allData.linie.find(l => l.numer === inputBuffer);
            if (selectedLine) {
                currentSetupState = 'CHOOSING_DIRECTION';
                inputBuffer = "";
                updateDisplay();
            } else {
                ibisLine2.textContent = 'BŁĄD: NIE ZNALEZIONO LINII';
                inputBuffer = "";
            }
        } else if (currentSetupState === 'CHOOSING_DIRECTION') {
            const directionIndex = parseInt(inputBuffer, 10) - 1;
            if (selectedLine.kierunki[directionIndex]) {
                startNavigation(selectedLine.kierunki[directionIndex].przystanki);
            } else {
                ibisLine2.textContent = 'BŁĄD: ZŁY KIERUNEK';
                inputBuffer = "";
            }
        }
    }

    // --- FUNKCJE ZARZĄDZAJĄCE NAWIGACJĄ I MAPĄ ---

    function initializeMap() {
        if (map) return;
        
        // NOWOŚĆ: Wyłączenie przybliżania podwójnym kliknięciem
        map = L.map('map', { zoomControl: false, doubleClickZoom: false }).setView([52.14, 21.23], 14);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // NOWOŚĆ: Definicja ikon
        const busIcon = L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png', // URL do ikony autobusu
            iconSize: [32, 32],
            iconAnchor: [16, 32],
        });

        // NOWOŚĆ: Stworzenie warstw dla lokalizacji i przystanku
        userDot = L.circleMarker([0, 0], { radius: 8, className: 'user-location-dot' }).addTo(map);
        userAccuracyCircle = L.circle([0, 0], { radius: 0, className: 'user-accuracy-circle' }).addTo(map);
        stopMarker = L.marker([0, 0], { icon: busIcon }).addTo(map);
    }

    function startNavigation(stops) {
        currentStops = stops;
        currentStopIndex = -1;
        
        setupScreen.classList.add('hidden');
        mapScreen.classList.remove('hidden');
        
        initializeMap();
        setTimeout(() => map.invalidateSize(), 100);

        // NOWOŚĆ: Rysowanie pełnej trasy na starcie
        drawFullRouteLine(stops);

        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(positionUpdate, handleError, { enableHighAccuracy: true });
        } else { alert("Geolokalizacja nie jest wspierana."); }
    }
    
    function positionUpdate(position) {
        const { latitude, longitude, accuracy } = position.coords;
        const userCoords = [latitude, longitude];
        
        // NOWOŚĆ: Aktualizacja kropki i okręgu dokładności
        userDot.setLatLng(userCoords);
        userAccuracyCircle.setLatLng(userCoords).setRadius(accuracy);

        if (currentStopIndex === -1) {
            currentStopIndex = findNearestStopIndex(latitude, longitude, currentStops);
            map.setView(userCoords, 16);
        }

        const targetStop = currentStops[currentStopIndex];
        const upcomingStop = currentStops[currentStopIndex + 1];

        stopMarker.setLatLng(targetStop.wspolrzedne);
        nextStopNameEl.innerText = targetStop.nazwa;
        const distance = calculateDistance(userCoords[0], userCoords[1], targetStop.wspolrzedne[0], targetStop.wspolrzedne[1]);
        distanceToStopEl.innerText = `${Math.round(distance)} m`;
        upcomingStopNameEl.innerText = upcoming ? upcoming.nazwa : 'Koniec trasy';

        drawRouteToNextStop(userCoords, targetStop.wspolrzedne);

        if (distance < 20) {
            currentStopIndex++;
            if (currentStopIndex >= currentStops.length) {
                alert("Koniec trasy!");
                backButton.click();
            }
        }
    }
    
    // NOWOŚĆ: Funkcja do rysowania pełnej trasy (przystanek po przystanku)
    function drawFullRouteLine(stops) {
        if (map && fullRoutePolyline) {
            map.removeLayer(fullRoutePolyline);
        }
        const routePoints = stops.map(stop => stop.wspolrzedne);
        fullRoutePolyline = L.polyline(routePoints, { 
            color: '#888', // Szary kolor dla ogólnej trasy
            weight: 4, 
            opacity: 0.7,
            dashArray: '5, 10' // Linia przerywana
        }).addTo(map);
    }

    async function drawRouteToNextStop(startCoords, endCoords) {
        if (ORS_API_KEY === '5b3ce3597851110001cf6248a991e35a46bb42e081be692630cc09ac' || !ORS_API_KEY) return;
        const url = `https://api.openrouteservice.org/v2/directions/cycling-road?api_key=${ORS_API_KEY}&start=${startCoords[1]},${startCoords[0]}&end=${endCoords[1]},${endCoords[0]}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.features && data.features.length > 0) {
                const routeCoordinates = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
                if (map && routeToNextStopPolyline) map.removeLayer(routeToNextStopPolyline);
                routeToNextStopPolyline = L.polyline(routeCoordinates, { color: '#0A84FF', weight: 5, opacity: 0.8 }).addTo(map);
            }
        } catch (error) { console.error('Błąd trasy:', error); }
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; const p1 = lat1 * Math.PI / 180; const p2 = lat2 * Math.PI / 180;
        const deltaP = (lat2 - lat1) * Math.PI / 180; const deltaL = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(deltaP/2)*Math.sin(deltaP/2) + Math.cos(p1)*Math.cos(p2)*Math.sin(deltaL/2)*Math.sin(deltaL/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c;
    }

    function findNearestStopIndex(userLat, userLon, stops) {
        let nearestIndex = 0; let minDistance = Infinity;
        stops.forEach((stop, index) => {
            const d = calculateDistance(userLat, userLon, stop.wspolrzedne[0], stop.wspolrzedne[1]);
            if (d < minDistance) { minDistance = d; nearestIndex = index; }
        }); return nearestIndex;
    }

    function handleError(error) { alert(`BŁĄD GEOLOKALIZACJI (${error.code}): ${error.message}`); }
});