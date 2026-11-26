# CCDC HSE — Equipment inspection

A simple tool for the HSE inspector to inspect cranes and forklifts, and to send a Word report.

1. The inspector opens **New inspection**, picks Crane or Forklift and fills in the machine details.
2. They go through the checklist section by section. Each item gets a rating (OK, Minor, Major, Critical, N/A), any number of photos or short videos, and an optional note.
3. At the bottom, **Others** takes any extra problem (with its own severity and photos). The inspector does not choose a result. The Word report ends with a Decision page (Accepted / Accepted with conditions / Rejected tick boxes, conditions lines, and sign-off for HSE and Operations departments), which they complete after receiving it. The machine header is Brand, Model, Capacity, Location, Inspection date, Certificate expiry and Inspector.
4. **Finish and create report** saves the inspection and makes a Word report (.docx) automatically, with the photos inside.
5. **Download** the file, or **Share…** to send it through the phone's share sheet (WhatsApp, WeChat, email and so on). On a computer, Share downloads the file instead.

The screens are in English and 中文. The Word report is in English.

## Admin page
An admin sees **Inspector | Admin** switch at the top. The Admin page is the checklist form editor, for crane and forklift:
- rename sections and items (English and 中文), add a hint or a reading (for example tyre depth in mm);
- move items up and down, even into another section; add or remove items and sections; hide an item without deleting it;
- **Save checklist.** Changes apply to new inspections. Saved inspections keep the form they were made with.

## Saved on the phone
Everything typed or photographed is saved on the phone as it is added. If the app closes or the connection drops, reopening it restores the unfinished inspection. Uploads resume without sending files twice.

## What the database enforces
- Only signed-in HSE inspectors and admins can see inspections and photos. Photos are private.
- Every checklist item must be rated before an inspection can be saved. Brand is required. The database stores no verdict.
- Photo and video files are checked on save (must belong to that inspection, must be real images or videos).
- Only admins can change the checklist form.

## Testing mode (on now)
There is no login page. The app opens straight on the main page as a test admin, so you can switch between Inspector and Admin. Anyone who opens the page can do this. **Before real use:** set `TEST_MODE: false` in `config.js` and delete the test account in the Supabase SQL editor:

```sql
delete from auth.users where email like '%.test@example.com';
```

## Set up
1. The database is migrated (`supabase/migrations/`).
2. In Supabase, open Authentication and either turn off "Confirm email" or set the Site URL to where the app is hosted.
3. Host the files (`index.html`, `app.js`, `i18n.js`, `report.js`, `config.js`, `styles.css`) on any static host, for example GitHub Pages.
4. Open the app and create an account. Give yourself the first admin role by running this once in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'YOUR-EMAIL';
```

5. For each inspector, set `role = 'hse'` the same way.

## Files
- `app.js`, `i18n.js`, `styles.css`, `index.html`: the app.
- `report.js`: builds the Word report (uses the `docx` library, loaded from a CDN).
- `config.js`: Supabase address and the public key. This key is safe to publish.
- `supabase/migrations/`: the database setup, in order.
