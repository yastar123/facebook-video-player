'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import {
  clearLoginFailures,
  createAdminSession,
  deleteAdminSession,
  isLoginBlocked,
  recordLoginFailure,
  verifyAdminCredentials,
} from '@/lib/auth'

export type LoginState = { error?: string }

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export async function loginAction(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'Masukkan email dan password yang valid.' }

  const email = parsed.data.email.trim().toLowerCase()
  const requestHeaders = await headers()
  const ipAddress = requestHeaders.get('x-real-ip')
    ?? requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  if (await isLoginBlocked(ipAddress)) return { error: 'Email atau password salah.' }
  if (!verifyAdminCredentials(email, parsed.data.password)) {
    await recordLoginFailure(ipAddress)
    return { error: 'Email atau password salah.' }
  }

  await clearLoginFailures(ipAddress)
  await createAdminSession(email)
  redirect('/dashboard')
}

export async function logoutAction() {
  await deleteAdminSession()
  redirect('/login')
}
