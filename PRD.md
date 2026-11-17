# Product Requirements Document — Facebook Video Player

**Status:** As-built repository snapshot; see section 14 for implementation and deployment status
**Last updated:** November 16, 2026  
**Product name:** Facebook Video Player  
**Document language:** Indonesian  
**Bahasa antarmuka web saat ini:** English


## 1. Ringkasan Produk

Facebook Video Player adalah aplikasi web untuk administrator yang mengelola URL video Facebook yang boleh di-embed, menyusunnya ke dalam playlist, dan membuka video melalui Facebook Embedded Video Player. Aplikasi dirancang untuk membantu pengelolaan konten dan pemutaran yang teratur—bukan untuk memanipulasi metrik Facebook.

### Prinsip utama

- Hanya mengelola dan memutar konten yang pengguna berwenang untuk akses dan embed.
- Tidak membuat fitur view farming, fake engagement, rotasi akun, atau peningkatan view secara artifisial.
- Riwayat aplikasi hanya mencatat kejadian yang benar-benar dapat diamati oleh aplikasi; bukan statistik view resmi Facebook.
- Menghormati batasan API, privasi video, kebijakan browser, dan kebijakan Facebook.
- Data administrator dan konten harus disimpan dengan aman dan persisten di PostgreSQL pada rilis produksi.

## 2. Masalah dan Tujuan

Administrator memerlukan satu tempat untuk mengelola daftar video Facebook, playlist, dan preferensi pemutaran tanpa mengandalkan daftar URL manual.

### Tujuan produk

1. Memusatkan pengelolaan URL dan metadata video.
2. Menyediakan playlist dengan urutan yang tersimpan.
3. Menyediakan pemutar embed resmi Facebook dengan kontrol dan status yang jujur.
4. Merekam aktivitas aplikasi yang dapat diamati dan menyediakan riwayatnya.
5. Melindungi seluruh fungsi admin dengan autentikasi dan otorisasi.
6. Dapat di-deploy pada VPS Ubuntu dengan konfigurasi yang terdokumentasi.

### Bukan tujuan

- Mengukur, menjanjikan, atau meningkatkan view, reach, watch time, engagement, atau performa Facebook.
- Mengunduh, menyalin, atau membuka akses ke video privat.
- Mengakali pembatasan embed, autoplay, atau kebijakan browser.
- Menyediakan registrasi publik atau akses multi-tenant pada rilis pertama.

## 3. Pengguna dan Hak Akses

### Administrator

Satu peran administrator untuk rilis awal. Administrator dapat mengelola video, playlist, pemutaran, riwayat aplikasi, pengaturan, dan akun administrator.

### Autentikasi

- Halaman login email dan password di `/login`.
- Tidak ada registrasi publik.
- Administrator pertama dibuat melalui proses bootstrap/seed yang aman di sisi server.
- Sesi dikelola server melalui cookie HTTP-only, Secure pada HTTPS, dan kebijakan SameSite yang sesuai.
- Semua halaman terlindungi dan semua route/mutasi memverifikasi sesi di server.
- Kegagalan login ditampilkan secara generik; detail diagnostik tidak membocorkan keberadaan email.

## 4. Ruang Lingkup Produk

### 4.1 Login — `/login`

- Form email dan password, validasi, tampil/sembunyikan password, remember me, loading, dan error state.
- Logout menghapus sesi.
- Dashboard tidak dapat diakses tanpa sesi administrator yang sah.

### 4.2 Dashboard — `/dashboard`

Menampilkan ringkasan yang berasal dari database:

- Total video.
- Total playlist.
- Jumlah event `FINISHED_PLAYING` yang tersimpan di database (bukan jumlah view Facebook); saat halaman dashboard terbuka, angka disinkronkan otomatis setiap 10 detik.
- Jumlah sesi player dengan heartbeat dalam lima menit terakhir; jumlah ini disinkronkan tiap 30 detik dan bukan indikator bahwa video sedang berjalan.
- Empat aktivitas aplikasi terbaru yang tersedia di state dashboard.
- Tiga playlist terbaru dan akses cepat ke tambah video, buat playlist, player, serta riwayat.

State awal harus memiliki empty state yang jujur, bukan angka atau aktivitas produksi yang direkayasa.
Angka selesai hanya berubah setelah event selesai diterima dari embed Facebook; pemutaran yang tidak melaporkan event tidak dihitung.

### 4.3 Manajemen Video — `/dashboard/videos`

- Daftar video dapat dicari berdasarkan judul atau URL, menampilkan status embed, dan menyediakan tautan untuk membuka video di Facebook.
- Video dapat ditambahkan melalui dialog dengan URL wajib dan judul opsional, lalu dihapus.
- Video dapat ditambahkan ke atau dikeluarkan dari playlist terpilih.
- URL divalidasi di server dan dibatasi ke HTTPS pada host Facebook yang didukung, termasuk `fb.watch`.
- Edit metadata, pagination, dan filter status belum tersedia.
- Status embed bukan jaminan permanen: izin, audience, dan konfigurasi pemilik video dapat berubah.

### 4.4 Playlist — `/dashboard/playlists`

- Playlist dapat dibuat dengan nama dan deskripsi, dipilih untuk melihat isinya, dan dihapus.
- Penghapusan playlist meminta konfirmasi dan menghapus seluruh sesi pemutaran beserta log yang terkait; jumlah event selesai dapat berkurang.
- Video dapat ditambahkan ke atau dikeluarkan dari playlist.
- Playlist kosong ditampilkan dengan empty state.
- Ganti nama, edit deskripsi setelah dibuat, drag-and-drop/reorder, dan halaman detail playlist terpisah belum tersedia.

### 4.5 Pemutar — `/dashboard/player`

- Pilih playlist, pilih item, dan gunakan pemutar embed resmi Facebook dalam mode tunggal atau tampilan serentak.
- Pemutar tunggal menyediakan kontrol aplikasi untuk memilih video sebelumnya/berikutnya serta daftar antrian.
- Autoplay, lanjut otomatis, loop, shuffle, suara dibisukan, dan batas jumlah pemutar bersamaan adalah preferensi tersimpan; browser atau Facebook dapat meminta klik manual.
- Loop untuk satu video mengulang item yang sama ketika event selesai diterima; playlist beberapa video dapat maju atau kembali ke awal sesuai preferensi.
- Pemutaran bergantung pada event embed yang benar-benar dikirim Facebook. Pemutar tidak menjanjikan autoplay atau status playback yang tidak teramati.
- Pemutar dashboard tetap bergantung pada tab administrator. Remote runtime adalah sesi browser terpisah di VPS dan tidak bergantung pada tab dashboard.

### 4.6 Riwayat — `/dashboard/history`

- Menampilkan hingga 30 event aplikasi terbaru yang tersedia, termasuk sesi dimulai/dihentikan, video dimuat, playback selesai, dan video berikutnya dimuat.
- Menampilkan waktu, judul video, playlist, dan jenis event.
- Pencarian, filter, pagination, serta tampilan terpisah untuk status sesi belum tersedia.
- Data ini tidak disebut sebagai statistik view resmi Facebook; event yang tidak dapat diamati tidak boleh disimpulkan.

### 4.7 Pengaturan — `/dashboard/settings`

- Preferensi pemutaran dan batas pemutaran serentak disimpan di PostgreSQL.
- Nama aplikasi dan zona waktu ditampilkan sebagai nilai read-only.
- Informasi administrator dan logout ditampilkan; ubah profil/password melalui halaman ini belum tersedia.

### 4.8 Remote Browser Runtime

- Runtime service terpisah di VPS dikelola PM2; prosesnya tetap berjalan saat browser administrator ditutup.
- `/dashboard/player` menampilkan status service, Chromium, playback engine, embed, playlist/konten/posisi, waktu playback teramati, uptime, heartbeat, error terakhir, dan log diagnostik.
- Kontrol administrator memulai, menghentikan, memulai ulang Chromium, atau meminta health check melalui route server yang memeriksa sesi.
- API runtime hanya bind ke loopback dan memerlukan secret bersama antara aplikasi dan service.
- Start memuat konten tersimpan pada Facebook Embedded Video Player/JavaScript SDK resmi di origin HTTPS aplikasi pada Chromium VPS; origin diteruskan oleh route admin setelah pemeriksaan same-origin. Untuk autoplay yang diizinkan, embed meminta autoplay resmi Facebook dalam keadaan tanpa suara; posisi yang bergerak juga diverifikasi sebagai bukti playback jika event `startedPlaying` tidak terkirim. Preferensi `autoPlayNext` mengatur perpindahan item; `loopPlaylist` menentukan apakah item/playlist berhenti setelah selesai atau diputar terus-menerus. Preferensi terbaru dibaca pada setiap transisi selesai.
- Runtime tidak menggunakan akun Facebook, cookie administrator, autoplay-policy flags, atau bypass untuk menghindari penolakan kebijakan. Facebook/browser dapat menolak autoplay; bila sinyal mulai tidak teramati, runtime menandai error dan tidak mengklaim video diputar.
- `PlaybackSession` dan `PlaybackLog` runtime menggunakan tabel existing. Event playback dan posisi hanya dicatat ketika event resmi atau kemajuan posisi dari embed teramati; bukan statistik atau bukti engagement Facebook.
- Playlist, posisi, waktu, dan sesi aktif disimpan untuk melanjutkan setelah runtime restart/crash. Stop mengakhiri sesi dan menutup browser dengan tertib.

## 5. Navigasi dan Desain UX

### Navigasi utama

- Workspace: Dashboard, Pemutar Video.
- Manajemen konten: Video, Playlist.
- Aktivitas: Riwayat Pemutaran.
- Preferensi: Pengaturan.
- Bagian bawah: identitas administrator dan logout.

### Karakter visual

- Minimal, profesional, bersih, dan konsisten seperti dashboard SaaS modern.
- Background `#FAFAFA`, surface `#FFFFFF`, teks utama `#18181B`, teks sekunder `#71717A`, border `#E4E4E7`, primary `#2563EB`, success `#16A34A`, warning `#D97706`, danger `#DC2626`.
- Tipografi Geist Sans atau Inter; radius sekitar 10–12px; bayangan minimal.
- Sidebar desktop dapat menyempit ke ikon; navigasi mobile memakai drawer yang dapat diakses keyboard.
- Layout responsif untuk desktop, tablet, dan mobile; label, focus state, kontras, dan alternative text harus diperhatikan.
- Loading, empty, success, dan error states tersedia di seluruh alur.

## 6. Model Data Target

Model berikut didefinisikan di `prisma/schema.prisma`. Tujuh migration tersedia di `prisma/migrations/0001_initial` hingga `0007_remote_browser_playback`. Pada database existing yang dibuat sebelum migration history, verifikasi schema awal lalu baseline `0001_initial` sebelum menjalankan `prisma migrate deploy`.

### `User`, `Session`, `Account`, `Verification`

- Schema `User` berisi `id`, `name`, `email` (unik), `emailVerified`, `image`, `role` (default `ADMIN`), `createdAt`, dan `updatedAt`.
- Model `Session`, `Account`, dan `Verification` disiapkan untuk adapter autentikasi.
- Login administrator memakai `ADMIN_EMAIL` dan `ADMIN_PASSWORD` dari environment. Identitas administrator dibuat/diperbarui setelah login valid; session disimpan di PostgreSQL dan cookie hanya berisi token acak yang hash HMAC-nya tersimpan di database. Password environment tidak disimpan ke tabel.
- `LoginAttempt` menyimpan kunci IP yang di-HMAC, jumlah percobaan, dan waktu blokir; alamat IP mentah tidak disimpan.

### `Video`

- `id`, `title`, `facebookUrl`, `facebookVideoId` nullable, `thumbnailUrl` nullable, `embedStatus`, `createdAt`, `updatedAt`.
- URL memiliki constraint unik global pada instalasi (satu administrator); URL/ID tidak boleh dieksekusi atau dirender sebagai HTML sewenang-wenang.

### `Playlist`

- `id`, `name`, `description` nullable, `isActive`, `createdAt`, `updatedAt`.
- Server menghapus sesi dan log yang terkait dalam transaksi sebelum menghapus playlist.

### `PlaylistVideo`

- `id`, `playlistId`, `videoId`, `position`, `createdAt`.
- Constraint unik `(playlistId, videoId)` dan `(playlistId, position)`, serta index pada `videoId`.
- Reorder atomik tetap menjadi kebutuhan API; antarmuka saat ini belum menyediakan drag-and-drop atau penyimpanan urutan.

### `PlaybackSession`

- `id`, `playlistId`, `currentVideoId` nullable, `status`, `startedAt`, `lastHeartbeatAt`, `endedAt` nullable, `createdAt`.
- Ringkasan hanya menghitung sesi dengan heartbeat dalam lima menit terakhir; heartbeat menandakan sesi aplikasi terhubung, bukan bukti view Facebook. Runtime menggunakan model sesi yang sama.

### `PlaybackLog`

- `id`, `sessionId`, `videoId` nullable, `eventType`, `metadata` (JSON tervalidasi, tanpa token), `createdAt`.
- Event hanya dibuat saat aplikasi benar-benar mengamati event tersebut.

### `AppSettings`

- Schema saat ini mencakup `id` (singleton `global`), `autoPlayNext`, `loopPlaylist`, `shufflePlaylist`, `autoplay`, `muted`, `maxConcurrent`, `endBehavior`, `appName`, `timezone`, `dateFormat`, `logRetentionDays`, `createdAt`, dan `updatedAt`.
- Toggle preferensi pemutaran dan batas pemutaran serentak disimpan; pengaturan identitas aplikasi masih read-only.

### `RemoteRuntimeStatus`, `RemoteRuntimeLog`

- `RemoteRuntimeStatus` menyimpan status proses dan browser, versi Chromium, waktu mulai, heartbeat terakhir, halaman browser, dan error terakhir.
- Migration `0007` menambah status embed/playback, playlist/video aktif, posisi, waktu terakhir, flag pemulihan, dan relasi ke `PlaybackSession`.
- `RemoteRuntimeLog` menyimpan event operasional yang sudah disanitasi; bukan event playback.
- Log runtime dibatasi ke 200 baris terbaru.

### Kepemilikan dan isolasi

Rilis awal menggunakan satu administrator per instalasi; model video, playlist, dan pengaturan belum memiliki `userId`. Semua API tetap wajib memeriksa sesi administrator di server. Jika produk berubah menjadi multi-tenant, tambahkan kepemilikan dan scope query sebelum membuka akses tersebut.

## 7. API Target

Semua endpoint memerlukan autentikasi/otorisasi dan validasi request dengan Zod. Respons error konsisten, tidak membocorkan stack trace atau data sensitif.

### Authentication

- Login, logout, dan current-user/session melalui mekanisme autentikasi yang dipilih.

### Videos

- `GET /api/videos` — daftar, pencarian, filter, pagination.
- `POST /api/videos` — tambah video.
- `GET /api/videos/[id]` — detail.
- `PATCH /api/videos/[id]` — edit.
- `DELETE /api/videos/[id]` — hapus.

### Playlists

- `GET /api/playlists`, `POST /api/playlists`.
- `GET /api/playlists/[id]`, `PATCH /api/playlists/[id]`, `DELETE /api/playlists/[id]`.
- `POST /api/playlists/[id]/videos` — tambah video.
- `DELETE /api/playlists/[id]/videos/[videoId]` — keluarkan video.
- `PATCH /api/playlists/[id]/reorder` — simpan posisi secara atomik.

### Playback

- `POST /api/playback/start` — mulai sesi aplikasi.
- `POST /api/playback/event` — catat event yang diamati.
- `POST /api/playback/next` — pindah seleksi ke item berikutnya sesuai aturan playlist.
- `POST /api/playback/stop` — akhiri sesi.
- `GET /api/playback/history` — daftar event dengan filter/pagination.

### Settings

- `GET /api/settings` dan `PATCH /api/settings`.

### Remote runtime

- `GET /api/admin/runtime` membaca status runtime untuk administrator.
- `POST /api/admin/runtime` menerima `start`, `stop`, `restart`, atau `health`, dengan sesi admin dan pemeriksaan origin.
- Backend meneruskan perintah hanya ke `127.0.0.1:RUNTIME_PORT`; endpoint internal membutuhkan bearer token dan tidak diekspos melalui Nginx.

## 8. Facebook Embed dan Batas Integrasi

- Gunakan Facebook Embedded Video Player/JavaScript SDK resmi dan dokumentasi resmi API sebagai sumber kebenaran.
- SDK tidak dimuat lebih dari satu kali; integrasi React harus membersihkan listener/resource saat unmount dan mencegah inisialisasi ganda.
- Validasi hostname sebelum membentuk URL plugin; jangan menerima URL arbitrer untuk iframe.
- Video dapat gagal di-embed karena privasi, audience, izin pemilik, perubahan kebijakan, atau ketersediaan dari Facebook.
- Implementasikan hanya event dan method yang didukung dokumentasi saat dikerjakan. Jika event selesai atau kontrol tertentu tidak tersedia, nyatakan keterbatasannya dan sediakan kontrol/manual fallback yang jujur.
- Dilarang memintas pengaturan akses, mengunduh video privat, atau memakai akun/otomasi untuk memanipulasi engagement.

## 9. Keamanan dan Privasi

- HTTPS di production; cookie sesi HTTP-only/Secure/SameSite dengan konfigurasi yang kompatibel dengan domain preview dan production.
- Password hashing, validasi server-side, Zod untuk seluruh input, parameterized ORM queries, dan pembatasan upaya login.
- Pemeriksaan sesi server pada halaman terlindungi, route, dan semua mutasi.
- CSRF/origin checks tetap aktif; tidak menonaktifkan kontrol keamanan untuk memperbaiki masalah cookie.
- Validasi URL berdasarkan protokol HTTPS dan allowlist host; iframe tidak menerima markup/HTML dari pengguna.
- Tidak menyimpan token Facebook kecuali fitur resmi benar-benar memerlukan dan desain keamanan telah ditinjau.
- Jangan log password, cookie, token, atau metadata sensitif. Terapkan retensi riwayat yang disepakati.
- Baseline response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS untuk HTTPS; `X-Frame-Options`/CSP disesuaikan agar tidak merusak preview embed dan kebutuhan Facebook.

## 10. Teknologi dan Infrastruktur Target

- UI saat ini: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Lucide React, dan komponen lokal; package shadcn CLI tersedia, tetapi dashboard belum memakai komponen shadcn.
- Server: Server Actions terautentikasi menangani video, playlist, preferensi, dan event pemutaran; layout dashboard memuat data melalui Prisma.
- Data: PostgreSQL melalui Prisma 7 dan `@prisma/adapter-pg`; deployment harus menerapkan migration dengan `prisma migrate deploy`.
- Validasi: input login, URL, playlist, dan preferensi divalidasi server-side dengan Zod. URL video dibatasi HTTPS dan host Facebook yang didukung.
- Embed menggunakan Facebook JavaScript SDK; event `xfbml.ready`, `startedPlaying`, `paused`, `finishedPlaying`, dan `error` didukung untuk pemutar yang relevan. Dashboard mempertahankan preferensi loopnya sendiri.
- Remote Browser Runtime menggunakan proses Node terpisah, Playwright/Chromium headless, PM2, heartbeat PostgreSQL, penyimpanan posisi, pemulihan terbatas saat Chromium crash, dan playback playlist melalui SDK resmi mengikuti preferensi `autoPlayNext` serta `loopPlaylist`. Pengulangan hanya mengikuti pilihan administrator untuk konten yang diizinkan, bukan untuk memanipulasi metrik.
- Hosting target: Ubuntu VPS, Node.js, environment variables, reverse proxy Nginx; Docker opsional.
- Header keamanan dasar dikonfigurasi pada Next.js. Rahasia dan konfigurasi hanya berasal dari environment/secret store, tidak di-commit.

## 11. Deployment VPS

Rencana deployment harus mencakup: checkout kode, instalasi dependency yang terkunci, konfigurasi environment produksi, provisioning PostgreSQL, migration terkontrol, bootstrap admin yang aman, build aplikasi, service manager/container, TLS, Nginx reverse proxy, backup database, rotasi secret, logging/monitoring, dan prosedur rollback.

Variabel yang dibutuhkan harus ditentukan final sebelum implementasi deployment, sekurangnya koneksi database, secret sesi/auth, URL canonical aplikasi bila diperlukan, serta variabel Facebook hanya bila SDK resmi memerlukannya. Nilai rahasia tidak boleh dimasukkan dalam dokumentasi atau repository.

Untuk database existing yang tabelnya dibuat sebelum Prisma migration history tersedia, backup dahulu dan pastikan schema cocok dengan `0001_initial`. Setelah itu jalankan `npx prisma migrate resolve --applied 0001_initial` satu kali untuk baseline, lalu `npx prisma migrate deploy` untuk menerapkan migration baru. Database kosong sebaiknya langsung menggunakan `npx prisma migrate deploy`. Jangan gunakan `prisma db push` pada deployment produksi.

### Remote Browser Runtime (Ubuntu VPS)

1. Tambahkan `RUNTIME_PORT=3012` dan secret acak minimal 32 karakter sebagai `RUNTIME_API_TOKEN` di secret store/.env server. Aplikasi Next.js dan PM2 runtime harus membaca nilai token yang sama. Jangan masukkan nilainya ke Git atau log.
2. Pastikan migrasi yang tersedia sudah tercatat, lalu jalankan `npm run db:migrate:deploy` dan `npm run db:generate`.
3. Instal dependency proyek dan OS untuk Chromium: `pnpm install --frozen-lockfile` (atau `npm install` sesuai prosedur server), `npx playwright install-deps chromium`, lalu jalankan `npx playwright install chromium` sebagai user aplikasi.
4. Jalankan proses runtime sebagai user Linux non-root agar sandbox Chromium tetap aktif. Runtime menolak berjalan sebagai root dan tidak memakai `--no-sandbox`.
5. Instal PM2 (`npm install -g pm2`), lalu sebagai user aplikasi jalankan `pm2 start ecosystem.config.cjs --only facebook-video-player-runtime`, `pm2 save`, dan ikuti perintah `pm2 startup` untuk user tersebut.
6. Restart proses Next.js existing setelah environment/migration siap. Jangan menambah port 3012 ke Nginx/firewall; service bind hanya ke `127.0.0.1`.
7. Periksa status melalui `/dashboard/player`, dan gunakan `pm2 status`, `pm2 logs facebook-video-player-runtime --lines 100` untuk operasi VPS.

PM2 menghidupkan kembali proses runtime setelah crash; runtime mencoba memulihkan Chromium maksimal tiga kali dalam lima menit. Tombol Start/Stop/Restart mengendalikan sesi playback/browser, bukan menghentikan daemon PM2, agar dashboard tetap dapat menghubunginya. Restart service Next.js tidak diperlukan untuk mengendalikan browser. Mode sekali/berulang mengikuti preferensi tersimpan administrator. Menutup dashboard tidak menghentikan daemon atau sesi Chromium; namun keberhasilan playback tidak dijamin dan tidak boleh disebut sebagai view Facebook.

## 12. Kriteria Penerimaan Rilis Produksi

### Autentikasi

- Login valid membuat sesi aman; reload mempertahankan sesi.
- Logout menghapus sesi; membuka URL terlindungi tanpa sesi mengalihkan ke login.
- Tidak ada registrasi publik atau autentikasi mock.

### Video dan playlist

- CRUD berlangsung di database; validasi URL/duplikat dan error state bekerja.
- Data tetap ada setelah reload.
- Urutan playlist tetap konsisten setelah reload dan operasi reorder bersamaan aman.
- Aksi hapus memiliki konfirmasi dan menangani relasi secara konsisten.

### Player dan riwayat

- Embed resmi menampilkan loading, success, dan error/fallback dengan jelas.
- Kontrol hanya mengklaim kemampuan yang benar-benar disediakan API.
- Pemutaran berurutan diuji terhadap sinyal event resmi dan kebijakan browser; kegagalan autoplay menampilkan tindakan manual.
- Riwayat mencatat event aplikasi yang teramati dan tidak mempresentasikannya sebagai view Facebook.

### Kualitas operasional

- Seluruh endpoint/mutasi terlindungi, tervalidasi, dan dibatasi pada data yang diotorisasi.
- TypeScript, lint/test yang tersedia, dan production build lolos.
- Layout dan alur penting diuji pada desktop, tablet, dan mobile.
- Backup, restore, HTTPS, environment secrets, dan prosedur deployment VPS terdokumentasi dan diuji.
- Runtime API hanya dapat dicapai melalui loopback dan memerlukan autentikasi admin di sisi Next.js serta secret service-ke-service.
- Status runtime/browser, heartbeat, uptime, Chromium version, recovery, embed, dan playback dibedakan. Event playback hanya berasal dari sinyal embed yang teramati; tidak ada loop remote atau klaim view/engagement.

## 13. Tahapan Implementasi

1. **Foundation:** schema Prisma, PostgreSQL, dan enam migration tersedia; migration `0006` telah diterapkan pada VPS menurut log deployment.
2. **Authentication:** login/logout, sesi database, proteksi halaman/mutasi, dan pembatasan percobaan login tersedia.
3. **Dashboard:** ringkasan berasal dari PostgreSQL; jumlah event selesai polling setiap 10 detik dan sesi terhubung polling setiap 30 detik.
4. **Content management:** tambah/cari/hapus video, buat/hapus playlist, dan kelola keanggotaan video tersedia. Penghapusan playlist menghapus sesi dan log terkait.
5. **Facebook player:** embed resmi digunakan; playback bergantung pada interaksi pengguna, kebijakan Facebook/browser, dan event yang diterima.
6. **History and settings:** riwayat aplikasi terbaru dan preferensi pemutaran tersedia; filter riwayat dan pengubahan pengaturan aplikasi belum tersedia.
7. **Remote runtime:** implementasi service Playwright/Chromium, kontrol, status, heartbeat, playback playlist melalui SDK resmi, persistence posisi PostgreSQL, dan recovery terbatas tersedia di repository. Uji playback aktual memerlukan deployment dengan migration terbaru dan harus dicatat terpisah.
8. **Deployment:** versi repository terbaru harus dibuild dan direstart agar tersedia di VPS; startup PM2 setelah reboot perlu diverifikasi.

## 14. Status Implementasi Saat Ini

### Implementasi yang tersedia di repository

- `/dashboard` mewajibkan sesi administrator. Login memakai `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `BETTER_AUTH_SECRET`; sesi tersimpan di tabel `Session` dan cookie HTTP-only/Secure pada production. Tidak ada registrasi publik.
- Dashboard memuat video, playlist, pengaturan, dan ringkasan aktivitas dari PostgreSQL melalui Prisma. Mutasi dilakukan dengan Server Actions yang memeriksa sesi dan memvalidasi input.
- Kartu `Video selesai` menghitung event `FINISHED_PLAYING` yang tersimpan dan menyinkronkan nilainya tiap 10 detik saat `/dashboard` terbuka. Ini hitungan event aplikasi, bukan analitik Facebook.
- Kartu sesi terhubung menghitung sesi dengan heartbeat dalam lima menit terakhir dan disinkronkan tiap 30 detik.
- Video dapat ditambahkan, dicari, dihapus, dan dimasukkan/dikeluarkan dari playlist. Playlist dapat dibuat dan dihapus. Hapus playlist meminta konfirmasi, menghapus sesi/log terkait, dan dapat mengurangi hitungan event selesai.
- Pemutar tunggal mencatat `SESSION_STARTED`, `VIDEO_LOADED`, `NEXT_VIDEO_LOADED`, `FINISHED_PLAYING`, dan `SESSION_STOPPED` saat event yang didukung diamati. Ini bukan statistik tayangan Facebook.
- Autoplay dapat memerlukan klik manual; pengaturan autoplay/loop tidak mengatasi penolakan kebijakan Facebook atau browser.
- Remote runtime terpisah tersedia melalui `runtime/server.ts` dan konfigurasi PM2. Start memuat playlist ke embed resmi, mencatat event SDK yang benar-benar teramati, mengikuti `autoPlayNext` dan `loopPlaylist`, serta menyimpan posisi. Tidak ada akun/cookie, bypass autoplay, atau klaim metrik Facebook.
- `/api/admin/runtime` memeriksa sesi admin, memvalidasi perintah, melakukan origin check pada mutasi, dan mem-proxy ke service loopback dengan bearer token.
- Migration `0002`–`0004` mengubah preferensi, rate limit login, dan URL duplikat; `0005_remote_browser_runtime` menambahkan status serta log operasional runtime; `0006_playback_session_heartbeat` menyinkronkan jumlah sesi melalui heartbeat; `0007_remote_browser_playback` menambah state playback remote yang persisten.
- VPS telah menerapkan migration `0006_playback_session_heartbeat` menurut log deployment. Perubahan repository setelah deployment perlu dibuild dan direstart sebelum tersedia di VPS.

### Belum tersedia

- Edit metadata video/playlist, drag-and-drop reorder, pagination/filter daftar, dan pengaturan aplikasi yang dapat diedit.
- Pencatatan lifecycle pemutaran untuk tampilan serentak; hanya event pemutar tunggal yang dicatat.
- Pengujian end-to-end dan konfigurasi rate-limit yang mempercayai IP dari reverse proxy harus diverifikasi pada VPS.
- Runtime dan Chromium telah berhasil dijalankan pada VPS Rocky Linux 8 sebagai user non-root; konfigurasi PM2 untuk startup setelah reboot masih perlu diverifikasi.
- Integrasi remote playback baru belum diuji atau dideploy pada VPS. Autoplay/akses embed bisa ditolak oleh Facebook atau Chromium; jika demikian, manual interaction mungkin tetap diperlukan dan runtime harus menunjukkan status error, bukan memalsukan event.
- Startup PM2 setelah reboot, recovery dari crash, dan hasil tes playback aktual harus diverifikasi pada server setelah migration `0007` diterapkan. Saat ini hanya pemeriksaan lokal TypeScript/unit test yang dapat diklaim.
- Perubahan repository terbaru untuk polling jumlah video selesai dan penghapusan playlist beserta riwayat belum didorong/dideploy ke VPS.

### Konfigurasi dan deployment

Sediakan `DATABASE_URL`, `BETTER_AUTH_SECRET` (minimal 32 karakter), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RUNTIME_PORT`, dan `RUNTIME_API_TOKEN` melalui environment/secret store server. Untuk database existing tanpa tabel `_prisma_migrations`, backup dan baseline `0001_initial` hanya setelah memastikan skema cocok; lalu jalankan `npx prisma migrate deploy` untuk seluruh migration yang belum diterapkan. Jangan menyimpan kredensial produksi di `.env.example`, source code, atau repository.

## 15. Risiko dan Asumsi

- Facebook dapat mengubah API, kebijakan, atau ketersediaan embed; integrasi harus diverifikasi ulang saat implementasi.
- Autoplay dipengaruhi gesture pengguna, audio, browser, dan Facebook; UI harus selalu memiliki fallback manual.
- Remote Browser Runtime dapat memuat playlist lewat embed resmi secara terpisah dari dashboard, tetapi tidak dapat menjamin autoplay headless, akses konten, atau ketersediaan embed. Menutup browser administrator tidak menghentikan daemon; ini bukan jaminan pemutaran atau view berkelanjutan.
- Kehidupan service PM2, status browser, ketersediaan embed, dan playback adalah status terpisah. Hanya sinyal dari player existing yang boleh menjadi event `PlaybackLog`.
- Runtime mengikuti pilihan putar sekali atau berulang dari preferensi `loopPlaylist` yang sudah tersedia; `autoPlayNext` menentukan apakah beralih item atau mengulang item aktif. Sumber video harus berizin; tidak ada bypass autoplay/login, fake engagement, atau penghitungan view platform.
- URL yang valid tidak membuktikan video dapat di-embed; status awal harus “belum diverifikasi” kecuali ada pemeriksaan yang sah.
- Log aplikasi bukan analitik Facebook dan dapat tidak lengkap jika event tidak dikirim oleh embed.
- Belum ada keputusan mengenai retensi log, single-admin versus multi-admin, kebijakan backup, serta domain production.
