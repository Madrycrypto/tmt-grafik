# TMT Grafik — brygady A/B/C/D, matrix kompetencji, zastępstwa

Aplikacja webowa (PWA) do planowania obsady linii produkcyjnych w ruchu ciągłym. Działa w przeglądarce na komputerze i na telefonie. Na telefonie można ją dodać do ekranu głównego jak zwykłą aplikację.

## Co potrafi

- **Uniwersalne linie i stanowiska**: dowolna liczba linii, dla każdego stanowiska wymagana liczba osób i minimalny poziom kompetencji.
- **Mieszany czas pracy**: pracownicy 8 h (PL), 12 h (CN) i agencja (8 lub 12 h) na jednej linii. Pokrycie liczone jest **dla każdej godziny**, więc widać np. dziurę 19:00–23:00.
- **Systemy zmianowe per linia**: 1, 2 lub 3 zmiany (pn–pt, rotacja tygodniowa) albo 4 brygady w ruchu ciągłym, na zmianach 8 h lub 12 h, z dowolną godziną startu (np. CFM: 06–14 / 14–22). Na jednej linii można łączyć system 8 h i 12 h.
- **Generator rotacji brygad**:
  - docelowa liczba dni pracy na brygadę w miesiącu; nadwyżka zamienia się w wolne rozłożone równomiernie,
  - **święta ustawowe** (14 dni, z Wigilią od 2025 r. i ruchomymi: Wielkanoc, Zielone Świątki, Boże Ciało): w systemach 1/2/3-zmianowych linia ma wolne jak w weekend, w ruchu ciągłym pracuje — przełącznik „wolne w święta” przy każdym systemie,
  - kalendarz zakładu z wyłączeniami, np. „niedziela, noc 23–07 nie pracujemy”, święta, postoje,
  - ręczna zmiana komórki jednym kliknięciem,
  - wiersz „Luki” pokazujący zmiany bez brygady,
  - kontrola 35 h odpoczynku tygodniowego.
- **Matrix 1–4**: stanowisko samodzielnie obsadza się od poziomu 3 (próg ustawiany per stanowisko). Pod tabelą liczba osób z wymaganym poziomem w każdej brygadzie, z alarmem, gdy jest mniej niż 2.
- **Zastępstwa kaskadowe**: po kliknięciu „Brak” aplikacja podpowiada do 3 wariantów:
  - osoba z rezerwy,
  - przesunięcie z innego stanowiska razem z podpowiedzią, kto zastąpi przesuniętego (do 3 ruchów),
  - dodatkowa zmiana lub agencja, tylko z zachowaniem 11 h odpoczynku.

  Pokazuje też osoby „zablokowane”, czyli jedyne kwalifikowane na swoim stanowisku. Wariant zatwierdzasz jednym kliknięciem, a wpis trafia do historii.
- **Lista pracowników**:
  - dodawanie i edycja pojedynczych osób,
  - **import z Excela (.xlsx), CSV albo wklejki z Excela** z podglądem przed zapisem (nowi, aktualizacje, wiersze z błędami); kolumny o nazwach stanowisk wczytują od razu poziomy matrycy,
  - eksport do CSV w tym samym formacie, więc można wyeksportować, poprawić w Excelu i wczytać z powrotem,
  - zaznaczanie wielu osób: zmiana brygady, przeniesienie na inną linię, dezaktywacja, usunięcie,
  - **usuwanie listą**: wklej nazwiska albo wczytaj plik; aplikacja pokaże, kogo znalazła, a kogo nie ma w bazie.
- **Eksport dla kadr** (Grafik lub Pracownicy → „Eksport dla kadr”), plik CSV otwierany w Excelu:
  - *tabela miesięczna*: nazwisko × dzień ze zmianą według grafiku (np. `07-15`, `23-07`, `07-15*` dla dodatkowej), W, L4, UW, NN; na końcu dni pracy, godziny, godziny nocne 22–6, godziny w niedzielę, godziny dodatkowe i dni nieobecności,
  - *lista dzienna*: wiersz na każdy dzień pracy lub nieobecności, ze stanowiskiem i godzinami od–do,
  - filtr po linii, typie pracownika albo konkretnej agencji (osobny plik dla każdej agencji).
- **Synchronizacja na żywo** między telefonem a komputerem (Supabase Realtime).
- **Bezpieczeństwo**: logowanie, token JWT przy każdym zapytaniu, lista dozwolonych e-maili z rolami `admin` / `editor` / `viewer`.

Bez skonfigurowanej bazy aplikacja działa w **trybie demo** na danych przykładowych zapisanych tylko w przeglądarce.

## Aplikacja pracownika

- Pracownik widzi tylko swój grafik, nieobecności i godziny (w tym godziny na stanowiskach). Baza nie wydaje mu danych innych osób.
- **Aktywacja kodem, bez e-maili:** *Pracownicy* → wpisz e-mail → zaznacz → „Zaproś do aplikacji”. Drukują się kartki z kodem QR i 6-znakowym kodem (PL/中文). Kod jest jednorazowy i ważny 14 dni. Zapomniane hasło: „Nowy kod + kartka”.
- **Powiadomienia push** o zmianach w grafiku na najbliższe 14 dni, w języku pracownika (funkcja serwerowa `supabase/functions/tmt-api`).
- Wymaga: `supabase/schema-pracownicy.sql`, wdrożonej funkcji `tmt-api` (bez weryfikacji JWT; sama sprawdza uprawnienia) oraz wyłączonego **Authentication → Sign In / Providers → Email → Confirm email** (konto i tak założy tylko osoba z listy i z ważnym kodem).
- iPhone: powiadomienia po dodaniu aplikacji do ekranu początkowego. Telefony bez usług Google mogą nie dostawać powiadomień w Chrome.

## Mieszane 8 h i 12 h

- Na stałe: karta pracownika → „Długość zmiany: 12 h”. W systemie 8 h zmiana poranna to 07–19, popołudniowa 11–23, nocna 19–07.
- Na jeden dzień: *Obsada* → przycisk „→ 12 h” przy osobie.
- Eksport dla kadr ma format „Godziny na stanowiskach (premie)”.

## Obsada na co dzień

- **Zapisywanie** — każda zmiana zapisuje się od razu; stan widać na dole menu („Zsynchronizowano”). Wyjątek: karta pracownika ma przycisk „Zapisz”.
- **Cofnij / Ponów** — przyciski ↶ ↷ w menu albo Ctrl+Z / Ctrl+Shift+Z. Cofa tylko dane zmienione daną operacją, więc nie nadpisuje zmian innych osób. Działa dla zmian z bieżącej sesji; każdy krok trafia do Historii.
- **Łączenie stanowisk** — w „Linie i stanowiska” kolumna „Łączy z” (np. OP50-2 ↔ OP51/52). Wtedy jedna osoba może obsłużyć oba: na jeden dzień w Obsadzie („Obsłuży też osoba z”), na stałe w karcie pracownika („Stale obsługuje też”). Podpowiedź zastępstwa woli łączenie od zabierania ludzi z innych stanowisk. Do premii godziny dzielą się po równo między łączone stanowiska.
- **Zmień…** przy osobie — przeniesienie na inne stanowisko albo do rezerwy (osoba mobilna) bez zaznaczania nieobecności oraz inna długość zmiany tylko na ten dzień. Stałą długość zmiany ustawia się w karcie pracownika.
- **Rozstaw wg matrycy** — ustawia obecnych na zmianie tak, żeby pokryć jak najwięcej stanowisk; kto ma kwalifikację tam, gdzie stoi, zostaje.
- **Stanowiska macierzyste wg matrycy** — w Matrycy pasek ostrzega, gdy ktoś ma macierzyste stanowisko bez kwalifikacji, i proponuje poprawkę.
- **Karta pracownika** — kliknięcie nazwiska w Matrycy lub Obsadzie.

## RCP — kiosk przy wejściu (odbicia bez klikania)

Tablet przy wejściu otwiera `…/tmt-grafik/#/kiosk` (najlepiej konto z rolą **kiosk**, Ustawienia → Dostęp). Dwa sposoby odbicia, oba **samym skanem** — kierunek ustala serwer:

- **Telefon skanuje tablet**: w aplikacji „Odbij się — skanuj kod” (albo zwykły aparat). Mały **żółty** kod = wyjście prywatne.
- **Tablet skanuje kartę** (jak w kioskach Calamari): karta RCP z kodem QR (Pracownicy → „Karty RCP”, wydruk w formacie karty) albo „Mój kod do tabletu” w telefonie. Wyjście prywatne: dotknąć żółtego przycisku, potem pokazać kartę.

Wynik: pełny ekran **zielony** (wejście, powrót), **czerwony** (wyjście), **żółty** (wyjście prywatne), z godziną i nazwiskiem. „Pomyłka? Cofnij” przez 10 s (serwer pozwala do 2 min). Drugi skan w ciągu minuty nie tworzy duplikatu. W ciągu dnia może być wiele wyjść prywatnych — ich czas nie wlicza się do pracy.

Bezpieczeństwo: kod tabletu zmienia się co 20 s i jest podpisany przez serwer (ważny 60 s); kod z telefonu pracownika tak samo; kod karty jest tajny, „Nowa karta” unieważnia zgubioną. Godzinę nadaje serwer.

**Panel RCP** (menu „RCP — obecność”): plan a odbicia, spóźnienia, wcześniejsze wyjścia, brak odbić, poza grafikiem, wyjścia prywatne. **✓ wg grafiku** uzupełnia brakujące odbicia jednym kliknięciem (pojedynczo albo wszystkich naraz); ręczne odbicie zostaje na wypadek awarii.

Odbicia: tabela `records` (kind = `punches`), karty: tabela `badges` (bez dostępu z aplikacji). Schemat: `supabase/schema-rcp.sql`, logika: `src/domain/punches.ts`.

## Wymiar czasu pracy i dopełnianie godzin

Grafik pokazuje **wymiar czasu pracy** miesiąca (KP art. 130) i bilans każdej brygady (np. −16 h przez niepracujące niedziele). **Dopełnij godziny** proponuje dodatkowe zmiany na innych liniach: tylko w dni wolne, na stanowiskach z luką, z kwalifikacją ≥ min i 11 h odpoczynku. **Matrix → Zakres: cały zakład** pokazuje kwalifikacje na wszystkich liniach.

**3 zmiany lekkie** (Ustawienia → Systemy): 4 brygady pn–pt, maks. 3 nocki w tygodniu. Przy 3 brygadach pn–pt nie da się mieć mniej niż 5 nocek z rzędu (11 h odpoczynku), dlatego potrzebna jest czwarta brygada; średnio 38 h/tydz., resztę dopełnia się na innych liniach.

## Uruchomienie lokalnie

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # testy logiki (rotacja, pokrycie, zastępstwa, 11 h)
npm run build
```

## Konfiguracja bazy (Supabase), jednorazowo

1. Na [supabase.com](https://supabase.com) utwórz projekt w regionie **Central EU (Frankfurt)**.
2. Otwórz **SQL Editor → New query**, wklej plik [`supabase/schema.sql`](supabase/schema.sql) i kliknij **Run**.
3. Dodaj siebie jako pierwszego administratora (jednorazowo, w SQL Editor):
   ```sql
   insert into public.allowed_users (email, role) values ('twoj.email@firma.pl', 'admin');
   ```
4. **Authentication → URL Configuration**: w polu *Site URL* wpisz adres aplikacji, np. `https://madrycrypto.github.io/tmt-grafik/`, i dodaj go też w *Redirect URLs*. Na ten adres wracają linki z e-maili (potwierdzenie konta, reset hasła).
5. Załóż swoje konto: w aplikacji kliknij **Pierwsze logowanie**, podaj e-mail i hasło, a potem kliknij link z e-maila. Możesz też użyć *Authentication → Users → Add user* z zaznaczonym *Auto Confirm User*.
   Kolejne osoby dodajesz już w aplikacji: **Ustawienia → Dostęp do aplikacji** (rola `admin`, `editor` lub `viewer`). Taka osoba wchodzi na adres aplikacji i wybiera **Pierwsze logowanie**. Konto może założyć tylko e-mail z listy, a obcy dostanie odmowę (blokuje to sama baza). Usunięcie z listy od razu odcina dostęp.
6. Skopiuj *Project URL* (przycisk **Connect** albo *Project Settings → Data API*) i klucz **publishable** (`sb_publishable_…`, dawniej „anon public”).
7. Klucze podaj na jeden z dwóch sposobów:
   - **Na stałe w wersji online**: GitHub → repozytorium → *Settings → Secrets and variables → Actions → New repository secret*: `VITE_SUPABASE_URL` oraz `VITE_SUPABASE_ANON_KEY`. Potem uruchom wdrożenie ponownie (zakładka *Actions*).
   - **Tylko w jednej przeglądarce**: w aplikacji *Ustawienia → Baza danych → Połącz*.
8. Pustą bazę możesz wypełnić danymi przykładowymi (*Ustawienia → Dane → Wgraj dane przykładowe*) albo od razu wpisać swoje linie i ludzi.

> Klucz publishable jest przeznaczony do przeglądarki. Sam w sobie nie daje dostępu do danych, bo baza wpuszcza tylko zalogowanych z listy `allowed_users`. **Klucza `sb_secret_…` (dawniej `service_role`) nigdy nie wpisuj do aplikacji ani repozytorium.**

## Publikacja online

### Wariant A: GitHub Pages (repozytorium publiczne)

1. Repozytorium → *Settings → Pages → Source: **GitHub Actions***.
2. Każdy `push` do `main` uruchamia testy, build i publikację. Adres to `https://<login>.github.io/<repo>/`.

W repozytorium jest tylko kod. Dane pracowników są wyłącznie w Supabase, za logowaniem.

### Wariant B: repozytorium prywatne + Cloudflare Pages (darmowe)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → *Workers & Pages → Create → Pages → Connect to Git* → wybierz repozytorium.
2. Ustaw build command `npm run build` i output directory `dist`.
3. W *Environment variables* dodaj `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` oraz `NODE_VERSION` = `22`.
4. W tym wariancie usuń `.github/workflows/deploy.yml` albo wyłącz GitHub Pages.

## Na telefonie

Otwórz adres aplikacji, a następnie:
- iPhone (Safari): **Udostępnij → Do ekranu początkowego**,
- Android (Chrome): **⋮ → Dodaj do ekranu głównego**.

## Struktura

```
src/domain/     logika bez interfejsu: rotacja, pokrycie godzinowe, zastępstwa (+ testy)
src/data/       tryb demo (localStorage) i Supabase (zapis, realtime, logowanie)
src/pages/      ekrany: Obsada, Grafik, Matrix, Pracownicy, Linie, Historia, Ustawienia
supabase/       schemat bazy z regułami dostępu
```

## Założenia do weryfikacji z kadrami

- Zmiana należy do dnia, w którym się zaczyna (nocka 23–07 z niedzieli to „niedziela N”).
- Kontrola tygodniowa zgłasza tygodnie z odpoczynkiem poniżej 35 h. Art. 133 § 2 KP dopuszcza 24 h przy zmianie zmiany, więc to informacja, a nie blokada.
- Pora nocna przyjęta jako 22:00–6:00 (do potwierdzenia z kadrami; jedna stała `NIGHT` w `src/domain/hrExport.ts`).
- Normę godzin w okresie rozliczeniowym ustawiasz pośrednio przez docelową liczbę dni brygad.
