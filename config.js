// Настройки подключения к Supabase.
// Supabase → Project Settings → API (или Data API):
//   SUPABASE_URL      = Project URL
//   SUPABASE_ANON_KEY = anon public key (или publishable key)
// Этот ключ публичный, его можно хранить в сайте. Ключ service_role сюда НЕ вставлять.
window.NFC_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  // Тарифы для админ-панели, сом в месяц
  PLANS: { start: { name: "Меню", price: 2000 }, cafe: { name: "Меню и заказы", price: 7000 }, net: { name: "Сеть", price: 15000 } },
  // Контакт поддержки, показывается ресторанам
  SUPPORT: "+996 ___ ___ ___"
};
