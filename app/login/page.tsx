import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'
import { getAdminSession } from '@/lib/auth'

export default async function LoginPage() {
  if (await getAdminSession()) redirect('/dashboard')

  return (
    <main className="grid min-h-dvh w-full bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden min-h-dvh overflow-hidden bg-[#101827] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 top-1/4 size-96 rounded-full bg-blue-500/20 blur-[100px]" />
          <div className="absolute -right-28 bottom-0 size-80 rounded-full bg-cyan-400/10 blur-[90px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] bg-[size:32px_32px] opacity-40" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500 text-lg font-semibold text-white">F</div>
          <span className="text-sm font-semibold tracking-wide">FB Video Player</span>
        </div>

        <div className="relative max-w-xl py-16">
          <p className="text-xs font-semibold tracking-[0.2em] text-blue-300 uppercase">Ruang kerja administrator</p>
          <h2 className="mt-6 text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">
            Kelola koleksi video dengan lebih teratur.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Akses pustaka video, daftar putar, dan pengaturan dalam satu ruang kerja.
          </p>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-blue-400" />
              Pustaka video
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-blue-400" />
              Daftar putar
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-blue-400" />
              Preferensi tersimpan
            </span>
          </div>
        </div>

        <p className="relative text-xs text-slate-400">Akses privat untuk administrator.</p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-6 py-12 sm:px-10 lg:px-12 xl:px-20">
        <div className="w-full max-w-md">
          <div className="mb-12 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-semibold text-white">F</div>
            <span className="text-sm font-semibold tracking-wide text-zinc-900">FB Video Player</span>
          </div>

          <p className="text-xs font-semibold tracking-[0.18em] text-blue-700 uppercase">Administrator</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">Selamat datang kembali</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Masuk untuk melanjutkan ke ruang kerja Anda.
          </p>

          <LoginForm />

          <p className="mt-8 text-center text-xs text-zinc-400">
            Halaman ini hanya untuk administrator yang berwenang.
          </p>
        </div>
      </section>
    </main>
  )
}
