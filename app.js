// Czekamy, aż cała strona się załaduje
document.addEventListener('DOMContentLoaded', () => {

    // --- SEKCJA INICJALIZACJI ---
    const map = L.map('map').setView([52.14, 21.23], 14); // Ustaw widok początkowy na swoją okolicę
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Ikony dla markera użytkownika i celu
    const userIcon = L.divIcon({ className: 'user-icon', iconSize: [20, 20] });
    const userMarker = L.marker([0, 0], { icon: userIcon }).addTo(map);
    const stopMarker = L.marker([0, 0]).addTo(map);
    
    // Elementy interfejsu
    const lineSelect = document.getElementById('line-select');
    const directionSelect = document.getElementById('direction-select');
    const startButton = document.getElementById('start-button');
    const nextStopNameEl = document.getElementById('next-stop-name');
    const distanceToStopEl = document.getElementById('distance-to-stop');

    // Zmienne przechowujące stan aplikacji
    let allData = null;
    let currentStops = [];
    let currentStopIndex = -1;
    let watchId = null;

    // --- SEKCJA ŁADOWANIA DANYCH I OBSŁUGI UI ---

    // 1. Wczytaj nasze trasy z pliku JSON
    fetch('moje_trasy.json')
        .then(response => response.json())
        .then(data => {
            allData = data;
            // Wypełnij select z liniami
            allData.linie.forEach((linia, index) => {
                const option = new Option(`${linia.numer}: ${linia.nazwa}`, index);
                lineSelect.add(option);
            });
            // Uruchom funkcję, aby wypełnić kierunki dla pierwszej linii
            updateDirectionSelect();
        });

    // 2. Funkcja aktualizująca listę kierunków, gdy zmienimy linię
    function updateDirectionSelect() {
        const selectedLineIndex = lineSelect.value;
        const line = allData.linie[selectedLineIndex];
        
        directionSelect.innerHTML = ''; // Wyczyść poprzednie opcje
        line.kierunki.forEach((kierunek, index) => {
            const option = new Option(kierunek.nazwa, index);
            directionSelect.add(option);
        });
    }

    // Nasłuchuj na zmianę linii, aby zaktualizować kierunki
    lineSelect.addEventListener('change', updateDirectionSelect);

    // 3. Co się dzieje po naciśnięciu START
    startButton.addEventListener('click', () => {
        if (watchId) { // Jeśli śledzenie jest aktywne, zatrzymaj je
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            startButton.textContent = 'START';
            startButton.style.backgroundColor = '#28a745';
            return;
        }

        // Pobierz wybraną trasę
        const selectedLine = allData.linie[lineSelect.value];
        const selectedDirection = selectedLine.kierunki[directionSelect.value];
        currentStops = selectedDirection.przystanki;
        currentStopIndex = -1; // Zresetuj indeks przystanku

        // Zmień wygląd przycisku i zablokuj selecty
        startButton.textContent = 'STOP';
        startButton.style.backgroundColor = '#dc3545';
        
        // Włącz śledzenie GPS!
        startGeolocation();
    });

    // --- SEKCJA GEOLOKALIZACJI I LOGIKI TRASY ---

    function startGeolocation() {
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(
                positionUpdate, 
                handleError, 
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        } else {
            alert("Geolokalizacja nie jest wspierana przez Twoją przeglądarkę.");
        }
    }
    
    // 4. Ta funkcja uruchamia się za każdym razem, gdy GPS zaktualizuje pozycję
    function positionUpdate(position) {
        const { latitude, longitude } = position.coords;

        // Aktualizuj pozycję markera użytkownika
        userMarker.setLatLng([latitude, longitude]);
        map.panTo([latitude, longitude]); // Centruj mapę na użytkowniku

        if (currentStops.length === 0) return;

        // Jeśli jeszcze nie zaczęliśmy trasy, znajdź najbliższy punkt startowy
        if (currentStopIndex === -1) {
            currentStopIndex = findNearestStopIndex(latitude, longitude, currentStops);
        }

        const targetStop = currentStops[currentStopIndex];

        // Aktualizuj marker celu i panel informacyjny
        stopMarker.setLatLng(targetStop.wspolrzedne);
        nextStopNameEl.innerText = targetStop.nazwa;

        const distance = calculateDistance(latitude, longitude, targetStop.wspolrzedne[0], targetStop.wspolrzedne[1]);
        distanceToStopEl.innerText = Math.round(distance);

        // 5. MAGICZNY MOMENT: "ZALICZANIE" PRZYSTANKU
        if (distance < 15) { // Tolerancja 15 metrów
            console.log(`Punkt ${targetStop.nazwa} zaliczony!`);
            
            currentStopIndex++; // Przechodzimy do następnego punktu na liście

            // Sprawdź, czy to koniec trasy
            if (currentStopIndex >= currentStops.length) {
                alert("Koniec trasy! Dobra robota!");
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
                startButton.textContent = 'START';
                startButton.style.backgroundColor = '#28a745';
                nextStopNameEl.innerText = '---';
                distanceToStopEl.innerText = '---';
            }
        }
    }

    function handleError(error) {
        alert(`BŁĄD GEOLOKALIZACJI (${error.code}): ${error.message}`);
    }

    // --- SEKCJA FUNKCJI POMOCNICZYCH ---

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Promień Ziemi w metrach
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
});