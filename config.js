// Supabase project: hse-equipment-inspection.
// The anon key is public by design and safe in the browser: all access is controlled by
// the login, roles and policies in supabase/migrations/20261123_joint_inspection.sql.
// TESTING MODE: shows one-tap sign-in buttons on the login page. Turn it off (false) before real use
// and delete the test accounts (see README). The passwords below are public because this file is public.
window.CFG = {
  TEST_MODE: true,
  TEST_USERS: [
    { role: 'admin', email: 'hse.test@example.com', password: 'HseTest#2026' }
  ],
  url: 'https://upqzgyctnxanvgefqtjb.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwcXpneWN0bnhhbnZnZWZxdGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNTA5NTIsImV4cCI6MjExMDkyNjk1Mn0.Ucl9y3Fcs7IlIqDowdBI8FFb0z8kfu3Sfs3Nkb8W4qU'
};
