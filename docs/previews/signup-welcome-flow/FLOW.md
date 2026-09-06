# Signup → first ranking flow (PR evaluation)

> Evaluation artifacts for the signup welcome-flow change. Screenshots were
> taken against the local dev server with live board data; the modal shots
> use a temporary preview harness (since removed) with stub identity props.

## Flow diagram

```mermaid
flowchart TD
    S["/signup<br/>(username + email + password)"]
    S -->|"signUp<br/>emailRedirectTo=/login?confirmed=1&next=from"| M{Session?}
    M -->|"yes (confirmation off, dev/test)"| W1["/me?welcome=1"]
    M -->|"no"| E["Check-your-email panel"]
    E -->|"clicks link in inbox"| L["/login?confirmed=1&next=...<br/>(PKCE code exchange signs them in)"]
    L -->|"banner: Email confirmed — welcome!"| A{Authed?}
    A -->|"yes (auto-forward)"| D{"next / from?"}
    A -->|"no (form login)"| F["signInWithPassword"]
    F --> D
    D -->|"deep link present"| R["original destination<br/>(e.g. /riders/ana)"]
    D -->|"none"| W2["/me?welcome=1"]
    W1 --> WM["WelcomeModal (0 rides only)"]
    W2 --> WM
    WM -->|"Start ranking (dismiss → localStorage)"| ME["/me search + rank"]
    WM -->|"See the live board first"| B["/ board"]
    ME -->|"5 / 10 ranked"| SH["ShareListCard milestones"]
```

Key properties:

- The confirmation link lands on **public** `/login`, so the PKCE code
  exchange can never race the `RequireAuth` gate (previously it landed on
  `/`, leaving fresh users on the board with no next step).
- Deep links survive the email round-trip: `RequireAuth` stashes `from`
  → signup encodes it as `?next=` → login forwards to it.
- The welcome modal only renders for confirmed users with **zero rides**;
  dismissal persists in `localStorage` (`cr.welcome.dismissed`) and clears
  the `?welcome` param.
- Privacy is stated three times, progressively: signup microcopy
  ("private by default") → modal lock-note → profile share opt-in.

## Screenshots

### 1. Signup — private-by-default microcopy under the CTA

![signup](./01-signup.png)

### 2. Login landing straight from the confirmation email

![login confirmed](./02-login-confirmed.png)

### 3. Welcome modal — example top-5 preview, optional avatar, privacy note

![welcome modal](./03-welcome-modal.png)

### 4. Welcome modal — mobile

![welcome modal mobile](./04-welcome-modal-mobile.png)
