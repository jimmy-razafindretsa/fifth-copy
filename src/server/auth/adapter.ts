import "server-only";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { OAuthProvider, Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { TypistNameFor } from "./typist-name";

/**
 * Thrown by the adapter methods Fifth Copy does not support (ADR 0009): no email lookups, no database
 * sessions, no verification tokens. Carries only the method name.
 */
export class Unsupported extends Error {
  constructor(method: string) {
    super(`Auth.js adapter method not supported: ${method}`);
  }

  override get name() {
    return "Unsupported";
  }
}

/** The user Auth.js sees: id, typist name and tokenVersion. There is no email (ADR 0009). */
export type AuthUser = { id: string; name: string; tokenVersion: number };

type Db = Pick<PrismaClient, "user" | "oAuthAccount">;
type Deps = { db: Db; typistNameFor: TypistNameFor };

const USER_SELECT = { id: true, typistName: true, tokenVersion: true } as const;
const CREATE_ATTEMPTS = 3;

// AdapterUser declares email / emailVerified; we never hold one, so the object has no such keys.
function toAdapterUser(row: { id: string; typistName: string; tokenVersion: number }): AdapterUser {
  const user: AuthUser = { id: row.id, name: row.typistName, tokenVersion: row.tokenVersion };
  return user as unknown as AdapterUser;
}

/** "github" -> GITHUB; null for a provider outside the OAuthProvider enum (credentials included). */
function toProvider(provider: string): OAuthProvider | null {
  const upper = provider.toUpperCase();
  return (Object.values(OAuthProvider) as string[]).includes(upper)
    ? (upper as OAuthProvider)
    : null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const unsupported = (method: string) => async (): Promise<never> => {
  throw new Unsupported(method);
};

/**
 * The Auth.js adapter over our models (ADR 0009, #786): `User` and `OAuthAccount` only, and it never
 * reads or writes an email. Implements what JWT sessions + OAuth linking need; everything else throws
 * Unsupported. The only Auth.js code touching Prisma.
 */
export function createAuthAdapter({ db, typistNameFor }: Deps): Adapter {
  async function accountUser(id: string) {
    const row = await db.user.findUnique({
      where: { id },
      select: { ...USER_SELECT, isGuest: true },
    });
    return row && !row.isGuest ? row : null;
  }

  return {
    // Only the profile name is read: id, email, emailVerified and image are dropped.
    async createUser({ name }) {
      for (let attempt = 1; ; attempt++) {
        const typistName = await typistNameFor({ name });
        try {
          const row = await db.user.create({
            data: { isGuest: false, typistName },
            select: USER_SELECT,
          });
          return toAdapterUser(row);
        } catch (error) {
          if (!isUniqueViolation(error) || attempt >= CREATE_ATTEMPTS) throw error;
        }
      }
    },

    // Sessions belong to accounts: a guest row is never an Auth.js user.
    async getUser(id) {
      const row = await accountUser(id);
      return row && toAdapterUser(row);
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const enumProvider = toProvider(provider);
      if (!enumProvider) return null;
      const link = await db.oAuthAccount.findUnique({
        where: { provider_providerAccountId: { provider: enumProvider, providerAccountId } },
        select: { user: { select: { ...USER_SELECT, isGuest: true } } },
      });
      return link && !link.user.isGuest ? toAdapterUser(link.user) : null;
    },

    // Only the provider and its account id are stored; provider tokens are dropped (#486).
    async linkAccount({ userId, provider, providerAccountId }: AdapterAccount) {
      const enumProvider = toProvider(provider);
      if (!enumProvider) throw new Unsupported(`linkAccount(${provider})`);
      await db.oAuthAccount.create({ data: { userId, provider: enumProvider, providerAccountId } });
    },

    // Auth.js calls this only to stamp emailVerified; profile data never overwrites the typist name.
    async updateUser({ id }) {
      const row = await accountUser(id);
      if (!row) throw new Unsupported("updateUser(unknown user)");
      return toAdapterUser(row);
    },

    getUserByEmail: unsupported("getUserByEmail"),
    createSession: unsupported("createSession"),
    getSessionAndUser: unsupported("getSessionAndUser"),
    updateSession: unsupported("updateSession"),
    deleteSession: unsupported("deleteSession"),
    createVerificationToken: unsupported("createVerificationToken"),
    useVerificationToken: unsupported("useVerificationToken"),
  };
}
