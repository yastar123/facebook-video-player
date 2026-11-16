import 'server-only'

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/prisma'

const sessionCookieName = 'fb-player-session'
const sessionLifetimeSeconds = 60 * 60 * 24 * 7
const loginWindowMilliseconds = 15 * 60 * 1000
const maxLoginFailures = 5

export type AdminIdentity = {
  id: string
  name: string
  email: string
}

function getAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 characters.')
  }
  return secret
}

function hashSessionToken(token: string) {
  return createHmac('sha256', getAuthSecret()).update(token).digest('hex')
}

function hashLoginIdentifier(ipAddress: string) {
  return createHmac('sha256', getAuthSecret()).update(`login:${ipAddress}`).digest('hex')
}

function matchesSecret(input: string, expected: string) {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer)
}

export function verifyAdminCredentials(email: string, password: string) {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be configured.')
  }

  return matchesSecret(email.trim().toLowerCase(), adminEmail.trim().toLowerCase())
    && matchesSecret(password, adminPassword)
}

export async function isLoginBlocked(ipAddress: string) {
  const key = hashLoginIdentifier(ipAddress)
  const attempt = await prisma.loginAttempt.findUnique({ where: { key } })
  if (!attempt) return false

  const now = new Date()
  if (attempt.blockedUntil && attempt.blockedUntil > now) return true
  if (attempt.windowStartedAt.getTime() + loginWindowMilliseconds <= now.getTime()) {
    await prisma.loginAttempt.delete({ where: { key } })
  }
  return false
}

export async function recordLoginFailure(ipAddress: string) {
  const key = hashLoginIdentifier(ipAddress)
  const now = new Date()

  return prisma.$transaction(async (transaction) => {
    const attempt = await transaction.loginAttempt.findUnique({ where: { key } })
    if (attempt?.blockedUntil && attempt.blockedUntil > now) return true
    if (!attempt || attempt.windowStartedAt.getTime() + loginWindowMilliseconds <= now.getTime()) {
      await transaction.loginAttempt.upsert({
        where: { key },
        create: { key, attempts: 1, windowStartedAt: now },
        update: { attempts: 1, windowStartedAt: now, blockedUntil: null },
      })
      return false
    }

    const attempts = attempt.attempts + 1
    await transaction.loginAttempt.update({
      where: { key },
      data: {
        attempts,
        blockedUntil: attempts >= maxLoginFailures ? new Date(now.getTime() + loginWindowMilliseconds) : null,
      },
    })
    return attempts >= maxLoginFailures
  })
}

export async function clearLoginFailures(ipAddress: string) {
  await prisma.loginAttempt.deleteMany({ where: { key: hashLoginIdentifier(ipAddress) } })
}

export async function createAdminSession(email: string) {
  getAuthSecret()
  const requestHeaders = await headers()
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      id: randomUUID(),
      name: 'Administrator',
      email,
      emailVerified: true,
      role: 'ADMIN',
    },
    update: {
      emailVerified: true,
      role: 'ADMIN',
    },
    select: { id: true },
  })

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000)
  await prisma.session.create({
    data: {
      id: randomUUID(),
      token: hashSessionToken(token),
      expiresAt,
      userId: user.id,
      ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45),
      userAgent: requestHeaders.get('user-agent')?.slice(0, 500),
    },
  })

  const cookieStore = await cookies()
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeSeconds,
    expires: expiresAt,
  })
}

export async function getAdminSession(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(sessionCookieName)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { token: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })

  if (!session) return null
  if (session.expiresAt <= new Date() || session.user.role !== 'ADMIN') {
    await prisma.session.delete({ where: { id: session.id } })
    return null
  }

  return { id: session.user.id, name: session.user.name, email: session.user.email }
}

export async function requireAdmin() {
  const admin = await getAdminSession()
  if (!admin) throw new Error('Unauthorized')
  return admin
}

export async function deleteAdminSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName)?.value
  if (token) {
    await prisma.session.deleteMany({ where: { token: hashSessionToken(token) } })
  }
  cookieStore.delete(sessionCookieName)
}
