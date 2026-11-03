# Pożyczki i spłaty

Prosty kalkulator pożyczek dla każdego dłużnika osobno. Dane w Supabase (RLS, logowanie e-mail + hasło), hosting na Vercel.

Statyczna aplikacja: `index.html`. Klucz publishable Supabase w pliku jest publiczny z założenia; dane chroni Row Level Security.

Logika liczenia (odsetki, rata, import z Notatek) jest w `loans.js` i ma testy jednostkowe. Uruchomienie: `node --test` (Node 22+, bez zależności).

Struktura: `index.html` (widok), `app.js` (obsługa strony i Supabase), `loans.js` (liczenie), `vendor/supabase.js` (biblioteka wgrana do repo, patrz `vendor/README.md`), `vercel.json` (nagłówki bezpieczeństwa, w tym CSP bez skryptów inline), `manifest.webmanifest` i `sw.js` (instalacja na telefonie i tryb offline: aplikacja otwiera się bez internetu, a dane z ostatniego wczytania są tylko do odczytu). Powiadomienia push: `sw.js` wyświetla je, a wysyła funkcja serwerowa `supabase/functions/send-push` (klucze VAPID generuje sama i trzyma w tabeli `push_config`, niedostępnej dla użytkowników). Migracje bazy są w `supabase/migrations/`.
