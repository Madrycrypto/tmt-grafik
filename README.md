# TMT Grafik — brygady A/B/C/D, matrix kompetencji, zastępstwa

Aplikacja webowa (PWA) do planowania obsady linii produkcyjnych w ruchu ciągłym. Działa w przeglądarce na komputerze i na telefonie. Na telefonie można ją dodać do ekranu głównego jak zwykłą aplikację.

## Co potrafi

- **Uniwersalne linie i stanowiska**: dowolna liczba linii, dla każdego stanowiska wymagana liczba osób i minimalny poziom kompetencji.
- **Mieszany czas pracy**: pracownicy 8 h (PL), 12 h (CN) i agencja (8 lub 12 h) na jednej linii. Pokrycie liczone jest **dla każdej godziny**, więc widać np. dziurę 19:00–23:00.
- **Generator rotacji 4 brygad** (system 8 h i 12 h):
  - docelowa liczba dni pracy na brygadę w miesiącu; nadwyżka zamienia się w wolne rozłożone równomiernie,
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
