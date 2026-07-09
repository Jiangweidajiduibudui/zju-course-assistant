import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query v5（docs/07 §4.5）：
 * - 只管理服务端状态（API 响应缓存）；用户持久状态事实源是 Dexie（db.ts）；
 * - 统一对象参数 useQuery({ queryKey, queryFn })；
 * - 用 gcTime（禁止旧名 cacheTime）；queryFn 必须把 signal 传给 fetch（lib/api.ts）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});
