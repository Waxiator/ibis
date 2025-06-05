document.addEventListener('DOMContentLoaded', () => {

    // --- SEKCJA KONFIGURACJI I INICJALIZACJI ---

    // WAŻNE: Wklej tutaj swój klucz API z OpenRouteService
    const ORS_API_KEY = 'TWOJ_KLUCZ_API';

    const map = L.map('map', { zoomControl: false }).setView([52.14, 21.23], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const userMarker = L.marker([0, 0]).addTo(map);
    const stopMarker = L.marker([0, 0]).addTo(map);
    let routePolyline = null; // Warstwa do rysowania trasy

    const lineSelect = document.getElementById('line-select');
    const directionSelect = document.getElementById('direction-select');
    const startButton = document.getElementById('start-button');
    const nextStopNameEl = document.getElementById('next-stop-name');
    const distanceToStopEl = document.getElementById('distance-to-stop');
    const upcomingStopNameEl = document.getElementById('upcoming-stop-name');
    const infoPanel = document.getElementById('info-panel');

    let allData = null;
    let currentStops = [];
    let currentStopIndex = -1;
    let watchId = null;
    let lastRouteDrawTime = 0; // Ogranicznik zapytań do API

    // --- SEKCJA ŁADOWANIA DANYCH I OBSŁUGI UI ---

    fetch('moje_trasy.json')
        .then(response => response.json())
        .then(data => {
            allData = data;
            allData.linie.forEach((linia, index) => {
                const option = new Option(`${linia.numer}: ${linia.nazwa}`, index);
                lineSelect.add(option);
            });
            updateDirectionSelect();
        });

    function updateDirectionSelect() {
        const line = allData.linie[lineSelect.value];
        directionSelect.innerHTML = '';
        line.kierunki.forEach((kierunek, index) => {
            const option = new Option(kierunek.nazwa, index);
            directionSelect.add(option);
        });
    }

    lineSelect.addEventListener('change', updateDirectionSelect);

    startButton.addEventListener('click', () => {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            startButton.textContent = 'START';
            startButton.style.backgroundColor = 'var(--green-color)';
            if (routePolyline) map.removeLayer(routePolyline);
            return;
        }

        const selectedLine = allData.linie[lineSelect.value];
        const selectedDirection = selectedLine.kierunki[directionSelect.value];
        currentStops = selectedDirection.przystanki;
        currentStopIndex = -1;

        startButton.textContent = 'STOP';
        startButton.style.backgroundColor = 'var(--red-color)';
        
        startGeolocation();
    });

    // --- SEKCJA GEOLOKALIZACJI I LOGIKI ---

    function startGeolocation() {
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(
                positionUpdate, 
                handleError, 
                { enableHighAccuracy: true }
            );
        } else {
            alert("Geolokalizacja nie jest wspierana przez Twoją przeglądarkę.");
        }
    }

    function positionUpdate(position) {
        const { latitude, longitude } = position.coords;
        const userCoords = [latitude, longitude];
        userMarker.setLatLng(userCoords);

        if (currentStopIndex === -1) {
            currentStopIndex = findNearestStopIndex(latitude, longitude, currentStops);
            map.setView(userCoords, 16); // Ustaw widok na użytkowniku na starcie
        }

        const targetStop = currentStops[currentStopIndex];
        const upcomingStop = currentStops[currentStopIndex + 1]; // Kolejny przystanek

        updateUi(targetStop, upcomingStop, userCoords);
        
        // Rysuj trasę, ale nie częściej niż co 5 sekund
        const now = Date.now();
        if (now - lastRouteDrawTime > 5000) {
            drawRouteToStop(userCoords, targetStop.wspolrzedne);
            lastRouteDrawTime = now;
        }
        
        const distance = calculateDistance(latitude, longitude, targetStop.wspolrzedne[0], targetStop.wspolrzedne[1]);
        if (distance < 20) { // Zwiększamy próg do 20m
            triggerNextStop();
        }
    }

    function updateUi(target, upcoming, userCoords) {
        stopMarker.setLatLng(target.wspolrzedne);
        nextStopNameEl.innerText = target.nazwa;
        
        const distance = calculateDistance(userCoords[0], userCoords[1], target.wspolrzedne[0], target.wspolrzedne[1]);
        distanceToStopEl.innerText = `${Math.round(distance)} m`;

        if (upcoming) {
            upcomingStopNameEl.innerText = upcoming.nazwa;
        } else {
            upcomingStopNameEl.innerText = 'Koniec trasy';
        }
    }
    
    // Funkcja do animacji i przejścia do kolejnego przystanku
    function triggerNextStop() {
        infoPanel.classList.add('fade-out');
        
        setTimeout(() => {
            currentStopIndex++;
            if (currentStopIndex >= currentStops.length) {
                alert("Koniec trasy! Dobra robota!");
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
                startButton.textContent = 'START';
                startButton.style.backgroundColor = 'var(--green-color)';
            } else {
                 // Reset animacji i update UI
                infoPanel.classList.remove('fade-out');
                const userCoords = userMarker.getLatLng();
                positionUpdate({ coords: { latitude: userCoords.lat, longitude: userCoords.lng } });
            }
        }, 400); // Czas musi być zgodny z animacją CSS
    }

    // --- SEKCJA ROUTINGU (NOWOŚĆ) ---

    async function drawRouteToStop(startCoords, endCoords) {
        if (ORS_API_KEY === '5b3ce3597851110001cf6248a991e35a46bb42e081be692630cc09ac') {
            console.warn("Wpisz swój klucz API OpenRouteService w pliku app.js!");
            return;
        }
        
        const url = `https://api.openrouteservice.org/v2/directions/cycling-road?api_key=${ORS_API_KEY}&start=${startCoords[1]},${startCoords[0]}&end=${endCoords[1]},${endCoords[0]}`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                const routeCoordinates = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]); // Zamiana [lon, lat] na [lat, lon]
                
                if (routePolyline) {
                    map.removeLayer(routePolyline);
                }
                routePolyline = L.polyline(routeCoordinates, { color: '#0A84FF', weight: 5, opacity: 0.8 }).addTo(map);
            }
        } catch (error) {
            console.error('Błąd podczas pobierania trasy:', error);
        }
    }

    // --- SEKCJA FUNKCJI POMOCNICZYCH ---

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const p1 = lat1 * Math.PI / 180;
        const p2 = lat2 * Math.PI / 180;
        const deltaP = (lat2 - lat1) * Math.PI / 180;
        const deltaL = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(deltaP / 2) * Math.sin(deltaP / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(deltaL / 2) * Math.sin(deltaL / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function findNearestStopIndex(userLat, userLon, stops) {
        let nearestIndex = 0;
        let minDistance = Infinity;
        stops.forEach((stop, index) => {
            const distance = calculateDistance(userLat, userLon, stop.wspolrzedne[0], stop.wspolrzedne[1]);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = index;
            }
        });
        return nearestIndex;
    }
    
    function handleError(error) {
        alert(`BŁĄD GEOLOKALIZACJI (${error.code}): ${error.message}`);
    }
});