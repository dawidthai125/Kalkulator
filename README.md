# Pożyczki i spłaty

Prosty kalkulator pożyczek dla każdego dłużnika osobno. Dane w Supabase (RLS, logowanie e-mail + hasło), hosting na Vercel.

Statyczna aplikacja: `index.html`. Klucz publishable Supabase w pliku jest publiczny z założenia; dane chroni Row Level Security.

Logika liczenia (odsetki, rata, import z Notatek) jest w `loans.js` i ma testy jednostkowe. Uruchomienie: `node --test` (Node 22+, bez zależności).
