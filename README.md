# CCDC HSE — Equipment inspection

Joint inspection of contractor cranes and forklifts before they work on a rig.

1. The contractor registers a machine and sends photos and short videos for a fixed checklist. They give information only, never pass or fail.
2. HSE rates every item (OK, minor, major, critical) and recommends accept, accept with conditions, reject, or "need more information".
3. Operations sees HSE's review and records the final decision.
4. Conditions come with due dates. The contractor sends proof of each fix and HSE verifies it.

The interface is in English and Chinese (中文). Switch with EN / 中文.

## Rules the database enforces
These are in the database, not just the screen, so they cannot be bypassed from the browser.

- Everyone must sign in. An admin gives each person a role: contractor, HSE, Operations or admin.
- A contractor sees only their own company's machines. Contractors never see HSE or Operations comments, only the message written for them.
- A submission is locked once sent. Fixing it means a new version (v2, v3), and the old versions stay.
- HSE reviews first, then Operations decides. Operations cannot decide before HSE.
- Any "critical" item blocks acceptance.
- If HSE rejects, Operations can only reject. (A senior sign-off to override is not built yet.)
- An expired or missing certificate blocks acceptance. Only HSE, Operations or an admin can change a certificate date.
- Every serial number can be registered once.
- Photos and videos are private, checked on submit (must be real files for that machine) and limited to 50 MB.
- Every action is recorded in a history that cannot be edited.
- Nothing is lost if the app is closed or the connection drops: photos, videos, notes and readings are saved on the phone as they are added. Reopening the app restores the draft, and a failed send resumes without re-uploading files that already went through.

## Testing mode (on now)
There is no login page. The app opens straight on the main page, signed in as a test Contractor. A **Test as** bar (top on a phone, left menu on a computer) switches between Contractor, a second Contractor, HSE, Operations and Admin in one tap. Nothing is typed.

These are real accounts with a password that is written in `config.js`, which is public. Anyone who opens the page can use them. That is fine for test data only. **Before real use:** set `TEST_MODE: false` in `config.js` and delete the test accounts in the Supabase SQL editor:

```sql
delete from auth.users where email like '%.test@example.com';
```

## Checklists
The crane checklist has 21 items in walk-around order, in sections: Machine and papers, Ground level, Hook and rope, Safety devices, Cab. The form shows a section bar to jump between sections and a count per section. Forklifts use the same section idea.

At the bottom is **Others**. The contractor taps **+ Add observation** (up to 10) to report anything else, with a description and optional photos or video. HSE can also add its own observations with a severity in the review form. A critical one blocks acceptance, like any critical item.

## Set up
1. The database is already migrated (`supabase/migrations/20261123_joint_inspection.sql`).
2. In Supabase, open Authentication and either turn off "Confirm email" or set the Site URL to where you host the app, so sign-up links work.
3. Host the files (`index.html`, `app.js`, `i18n.js`, `config.js`, `styles.css`) on any static host, for example GitHub Pages.
4. Open the app and create your own account. Then make yourself the first admin by running this once in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'YOUR-EMAIL';
```

5. After that, approve everyone else in the app under Team: choose their role and, for contractors, their company.

## Try it with three test accounts
Create a contractor, an HSE and an Operations account, approve them in Team, then go through: register a machine, send photos, HSE review, Operations decision.

## Files
- `app.js`, `i18n.js`, `styles.css`, `index.html`: the app.
- `config.js`: Supabase address and the public key. This key is safe to publish.
- `supabase/migrations/`: the full database setup.
