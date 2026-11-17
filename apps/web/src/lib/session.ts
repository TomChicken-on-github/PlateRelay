import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client, idem, type Schemas, unwrap } from "./api";

export type Me = Schemas["Me"];
export type Permission = Schemas["Permission"];

const ME = ["me"] as const;

/** The signed-in account, or null when nobody is signed in. */
export function useSession() {
  return useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return await unwrap(client.GET("/me"));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60e3,
  });
}

/** The account for pages behind sign-in. */
export function useMe(): Me {
  const me = useSession().data;
  if (!me) throw new Error("useMe outside a signed-in page");
  return me;
}

export const can = (me: Me | null | undefined, ...perms: Permission[]) => !!me && perms.some((p) => me.permissions.includes(p));

export function useSessionActions() {
  const qc = useQueryClient();
  const signedIn = (me: Me) => qc.setQueryData(ME, me);
  return {
    login: async (username: string, password: string) => signedIn(await unwrap(client.POST("/auth/login", { body: { username, password } }))),
    register: async (body: { username: string; displayName: string; password: string; inviteCode?: string }) =>
      signedIn(await unwrap(client.POST("/auth/register", { params: idem(), body: { method: body.inviteCode ? "INVITE" : "OPEN", ...body } }))),
    logout: async () => {
      await unwrap(client.POST("/auth/logout")).catch(() => {});
      signOut(qc);
    },
  };
}

/** Forget everything loaded for the account; the sign-in page shows. */
export function signOut(qc: QueryClient) {
  qc.setQueryData(ME, null);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
}

export function useAuthMethods() {
  return useQuery({ queryKey: ["auth-methods"], queryFn: () => unwrap(client.GET("/auth/methods")), staleTime: 60e3 });
}
