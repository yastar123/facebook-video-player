# Product Requirements Document — Facebook Video Player

**Status:** Draft / requirements baseline  
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
- Jumlah video yang selesai diputar dalam konteks aplikasi (bukan jumlah view Facebook).
- Status player/sesi aktif.
- Video dan playlist pada sesi aktif bila ada.
- Aktivitas aplikasi terbaru.
- Playlist aktif dan akses cepat ke tambah video, buat playlist, player, serta riwayat.

State awal harus memiliki empty state yang jujur, bukan angka atau aktivitas produksi yang direkayasa.

### 4.3 Manajemen Video — `/dashboard/videos`

- Daftar video dengan pagination, pencarian, dan filter status.
- Tambah video melalui dialog; URL wajib, judul opsional.
- Edit judul dan informasi video, lihat detail/preview, hapus dengan konfirmasi, dan tambahkan ke playlist.
- Validasi server-side atas URL, host yang diperbolehkan (domain Facebook yang didukung, termasuk `fb.watch` bila dapat di-embed), serta URL duplikat dalam cakupan pengguna.
- Simpan judul, URL Facebook, ID video bila dapat diambil secara valid, thumbnail bila disediakan secara sah, status embed, dan timestamp.
- Status embed bukan jaminan permanen: izin, audience, dan konfigurasi pemilik video dapat berubah.

### 4.4 Playlist — `/dashboard/playlists`

- Buat, ganti nama, edit deskripsi, aktifkan/nonaktifkan, dan hapus playlist.
- Lihat jumlah video dan tanggal pembuatan/pembaruan.
- Tambah/hapus video dari playlist.
- Urutkan item melalui drag-and-drop; perubahan urutan disimpan secara transaksional dan tetap ada setelah reload.
- Detail playlist berada pada `/dashboard/playlists/[id]`.
- Detail menyediakan tambah video, simpan urutan, mulai pemutaran, edit, dan hapus.
- Playlist kosong dan urutan bersamaan harus ditangani dengan jelas.

### 4.5 Pemutar — `/dashboard/player`

- Pilih playlist dan item video.
- Tampilkan player Facebook resmi dengan rasio 16:9, judul, urutan, status/loading/error, dan daftar antrian.
- Sediakan kontrol aplikasi untuk video sebelumnya/berikutnya dan pemilihan item. Kontrol play/pause/fullscreen hanya disediakan bila didukung oleh API embed resmi.
- Tandai item terpilih, item berikutnya, dan item yang selesai hanya bila sinyal tersebut benar-benar tersedia.
- Pengaturan auto-advance, loop, shuffle, dan autoplay adalah preferensi—bukan jaminan bahwa browser/Facebook akan memulai playback otomatis.
- Bila event selesai tersedia: cek preferensi auto-advance, muat video selanjutnya, dan tampilkan fallback “Lanjutkan” bila kebijakan browser mengharuskan interaksi pengguna.
- Jangan mengklaim kemampuan event/kontrol yang tidak tersedia. Autoplay bersuara tidak boleh diasumsikan.

### 4.6 Riwayat — `/dashboard/history`

- Mencatat event aplikasi yang benar-benar diterima/diamati, antara lain sesi dimulai/dihentikan, video dimuat, playback mulai/jeda/selesai, video berikutnya dimuat, dan error.
- Menampilkan waktu, judul video, playlist, jenis event, dan status sesi.
- Pencarian, filter tanggal/playlist/jenis event, dan pagination.
- Data ini tidak disebut sebagai statistik view resmi Facebook; event yang tidak dapat diamati tidak boleh disimpulkan.

### 4.7 Pengaturan — `/dashboard/settings`

- Preferensi pemutaran: auto-advance, loop, shuffle, autoplay, serta perilaku sesudah video terakhir.
- Pengaturan aplikasi: nama, zona waktu, format tanggal, preferensi tampilan.
- Pengaturan akun: nama administrator, email, ubah password, dan logout.
- Semua pengaturan tersimpan di PostgreSQL dan dibatasi pada administrator.

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

Model berikut sudah didefinisikan di `prisma/schema.prisma` dan migration awal tersedia di `prisma/migrations/0001_initial/migration.sql`. Migration belum diterapkan pada database PostgreSQL, sehingga schema belum diverifikasi terhadap database produksi.

### `User`, `Session`, `Account`, `Verification`

- Schema `User` berisi `id`, `name`, `email` (unik), `emailVerified`, `image`, `role` (default `ADMIN`), `createdAt`, dan `updatedAt`.
- Model `Session`, `Account`, dan `Verification` disiapkan untuk adapter autentikasi.
- Password tidak disimpan plaintext; kolom `Account.password` disediakan untuk hash yang dikelola oleh pustaka autentikasi. Login, hashing, sesi aktif, dan bootstrap admin belum diimplementasikan.

### `Video`

- `id`, `title`, `facebookUrl`, `facebookVideoId` nullable, `thumbnailUrl` nullable, `embedStatus`, `createdAt`, `updatedAt`.
- URL memiliki constraint unik global pada instalasi (satu administrator); URL/ID tidak boleh dieksekusi atau dirender sebagai HTML sewenang-wenang.

### `Playlist`

- `id`, `name`, `description` nullable, `isActive`, `createdAt`, `updatedAt`.

### `PlaylistVideo`

- `id`, `playlistId`, `videoId`, `position`, `createdAt`.
- Constraint unik `(playlistId, videoId)` dan `(playlistId, position)`, serta index pada `videoId`.
- Reorder atomik tetap menjadi kebutuhan API; antarmuka saat ini belum menyediakan drag-and-drop atau penyimpanan urutan.

### `PlaybackSession`

- `id`, `playlistId`, `currentVideoId` nullable, `status`, `startedAt`, `endedAt` nullable, `createdAt`.

### `PlaybackLog`

- `id`, `sessionId`, `videoId` nullable, `eventType`, `metadata` (JSON tervalidasi, tanpa token), `createdAt`.
- Event hanya dibuat saat aplikasi benar-benar mengamati event tersebut.

### `AppSettings`

- Schema saat ini mencakup `id` (singleton `global`), `autoPlayNext`, `loopPlaylist`, `shufflePlaylist`, `autoplay`, `endBehavior`, `appName`, `timezone`, `dateFormat`, `logRetentionDays`, `createdAt`, dan `updatedAt`.
- Schema tersedia; halaman Settings saat ini hanya menampilkan preferensi sementara dan beberapa nilai contoh yang read-only.

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
- Server: halaman dashboard App Router tersedia; Route Handlers/Server Actions untuk data masih target dan belum diimplementasikan.
- Data target: PostgreSQL melalui Prisma 7 dan `@prisma/adapter-pg`; schema serta adapter sudah ada, tetapi belum tersambung ke database.
- Validasi: Zod sudah menjadi dependency; validasi server-side belum dibuat. Form video pada preview hanya memeriksa URL di browser.
- Embed saat ini menggunakan iframe plugin Facebook untuk contoh video; Facebook JavaScript SDK dan event API belum diintegrasikan.
- Hosting target: Ubuntu VPS, Node.js, environment variables, reverse proxy Nginx; Docker opsional.
- Header keamanan dasar dikonfigurasi pada Next.js. Rahasia dan konfigurasi hanya berasal dari environment/secret store, tidak di-commit.

## 11. Deployment VPS

Rencana deployment harus mencakup: checkout kode, instalasi dependency yang terkunci, konfigurasi environment produksi, provisioning PostgreSQL, migration terkontrol, bootstrap admin yang aman, build aplikasi, service manager/container, TLS, Nginx reverse proxy, backup database, rotasi secret, logging/monitoring, dan prosedur rollback.

Variabel yang dibutuhkan harus ditentukan final sebelum implementasi deployment, sekurangnya koneksi database, secret sesi/auth, URL canonical aplikasi bila diperlukan, serta variabel Facebook hanya bila SDK resmi memerlukannya. Nilai rahasia tidak boleh dimasukkan dalam dokumentasi atau repository.

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

## 13. Tahapan Implementasi

1. **Foundation (sebagian):** aplikasi dan UI preview tersedia; schema Prisma, migration awal, adapter PostgreSQL, lint, dan typecheck sudah disiapkan. Koneksi database, penerapan migration, dan konfigurasi environment masih menunggu.
2. **Authentication:** bootstrap admin, login/logout, sesi aman, perlindungan halaman dan API.
3. **Dashboard shell:** sidebar responsif, header, dashboard terhubung ke data.
4. **Content management:** CRUD video, CRUD playlist, detail, pencarian, filter, pagination, reorder.
5. **Facebook player:** verifikasi API resmi, embed lifecycle, kontrol/event yang didukung, fallback.
6. **History and settings:** pencatatan event observabel, pencarian/filter, preferensi tersimpan.
7. **Production:** pengujian end-to-end, keamanan, responsive QA, build, migration, deployment VPS dan runbook.

## 14. Status Implementasi Saat Ini

### Yang tampak pada web preview

- Root mengarahkan ke `/dashboard`; satu dashboard responsif memuat Overview, Videos, Playlists, Player, Playback history, dan Settings melalui navigasi sisi desktop serta drawer/overlay mobile.
- Antarmuka berbahasa Inggris, dengan latar netral terang, panel putih, dan aksen biru.
- Overview menampilkan jumlah contoh video/playlist, status player idle, aktivitas kosong, playlist, dan quick actions. Nilai tersebut bukan data produksi.
- Videos menampilkan tabel dengan pencarian browser, tombol filter UI, dialog tambah URL/judul, dan hapus. Validasi URL hanya di browser; perubahan berada dalam React state dan hilang saat refresh. Pagination dan filter belum berfungsi.
- Playlists mendukung dialog buat, pilih playlist, toggle video, dan hapus pada state lokal. Edit, penyimpanan, detail route, dan reorder belum tersedia.
- Player menampilkan iframe Facebook untuk URL contoh, playlist selector/queue, pemilihan item, previous/next, dan preferensi sementara. Embed tidak dipastikan tersedia, event lifecycle tidak dilacak, dan auto-advance tidak berjalan.
- Playback history selalu empty; tombol Search belum terhubung. Settings berisi toggle sesi dan field aplikasi contoh/read-only.
- UI dengan sengaja menampilkan banner preview dan tidak mengklaim menyimpan data atau merekam view Facebook.

### Fondasi kode yang tersedia di repository

- Prisma 7 schema PostgreSQL dan migration SQL awal untuk autentikasi, video, playlist, playback session/log, serta pengaturan.
- Prisma PostgreSQL adapter, konfigurasi CLI, `.env.example`, dan script generate/migrate/build telah ditambahkan.
- Migration SQL dibuat dari schema secara offline dan belum dijalankan terhadap database. Tidak ada koneksi database aktif atau data pengguna.
- ESLint dan pemeriksaan TypeScript tersedia; Prisma schema valid. Header keamanan dasar dikonfigurasi pada Next.js.

### Belum tersedia — jangan dianggap production-ready

- Database PostgreSQL terhubung, migration diterapkan, atau data persisten.
- Login, sesi autentikasi, bootstrap admin, otorisasi server, dan rate limiting.
- API backend yang terlindungi; seluruh pengelolaan UI masih lokal/sample.
- Drag-and-drop reorder, pencarian/filter/pagination server-side, atau pengaturan tersimpan.
- Event Facebook yang tervalidasi, auto-advance berdasarkan event, dan playback history yang tercatat.
- Test end-to-end, build/deploy produksi, serta konfigurasi dan runbook VPS.

### Konfigurasi yang diperlukan untuk melanjutkan

Pemeriksaan konfigurasi proyek terakhir menunjukkan belum ada environment variables. `DATABASE_URL` diperlukan untuk menghubungkan dan memigrasikan PostgreSQL yang dipilih; `BETTER_AUTH_SECRET` diperlukan sebelum konfigurasi Better Auth dibuat. Pengguna melewati prompt setup variabel, jadi migration live, autentikasi, dan API terlindungi belum dijalankan atau dibuat. Nilai rahasia tidak boleh ditulis ke PRD, source code, atau repository; tambahkan melalui Vars proyek sebelum melanjutkan backend.

## 15. Risiko dan Asumsi

- Facebook dapat mengubah API, kebijakan, atau ketersediaan embed; integrasi harus diverifikasi ulang saat implementasi.
- Autoplay dipengaruhi gesture pengguna, audio, browser, dan Facebook; UI harus selalu memiliki fallback manual.
- URL yang valid tidak membuktikan video dapat di-embed; status awal harus “belum diverifikasi” kecuali ada pemeriksaan yang sah.
- Log aplikasi bukan analitik Facebook dan dapat tidak lengkap jika event tidak dikirim oleh embed.
- Belum ada keputusan mengenai retensi log, single-admin versus multi-admin, kebijakan backup, serta domain production.
