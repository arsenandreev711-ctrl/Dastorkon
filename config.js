// Настройки подключения к Supabase.
// Supabase → Project Settings → API (или Data API):
//   SUPABASE_URL      = Project URL
//   SUPABASE_ANON_KEY = anon public key (или publishable key)
// Этот ключ публичный, его можно хранить в сайте. Ключ service_role сюда НЕ вставлять.
window.NFC_CONFIG = {
  SUPABASE_URL: "https://chyfdpoujkszhmfqzdwx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoeWZkcG91amtzemhtZnF6ZHd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3Njk1NTksImV4cCI6MjExMDM0NTU1OX0.v-H6mi4hvJqzRwE2HyVQTjkMKnb_wUxqzHnK_-ffclY",
  // Тарифы для админ-панели, сом в месяц
  PLANS: { start: { name: "Меню", price: 2000 }, cafe: { name: "Меню и заказы", price: 7000 }, net: { name: "Сеть", price: 15000 } },
  // Контакт поддержки, показывается ресторанам
  SUPPORT: "+996 ___ ___ ___"
};
