import {
  type QueryStatus,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AxiosError } from "axios";

import { DEFAULT_REFETCH_INTERVAL } from "@app/Constants";
import type { AgentRun } from "@app/api/agentic/contract";
import {
  createAgentRun,
  deleteAgentRun,
  getAgentRun,
  getAgentRuns,
} from "@app/api/rest";
import {
  AGENTIC_QUERY_RETRY,
  pollUnlessErrored,
} from "@app/queries/agentic-polling";

export const AGENT_RUNS_QUERY_KEY = "agentRuns";
export const AGENT_RUN_QUERY_KEY = "agentRun";

export const useFetchAgentRuns = (
  refetchInterval: number | false = DEFAULT_REFETCH_INTERVAL
) => {
  const { isLoading, error, data, refetch } = useQuery({
    queryKey: [AGENT_RUNS_QUERY_KEY],
    queryFn: getAgentRuns,
    onError: (error: AxiosError) => console.log(error),
    retry: AGENTIC_QUERY_RETRY,
    refetchInterval: (_data, query) =>
      pollUnlessErrored(query, refetchInterval),
    // Runs mutate server-side while the user is elsewhere — keep polling
    // even when the tab is hidden so the page is current on return.
    refetchIntervalInBackground: true,
  });

  return {
    agentRuns: data || [],
    isLoading,
    fetchError: error,
    refetch,
  };
};

export const useFetchAgentRun = (
  name: string,
  refetchInterval: number | false = DEFAULT_REFETCH_INTERVAL
) => {
  const { isLoading, error, data } = useQuery({
    queryKey: [AGENT_RUN_QUERY_KEY, name],
    queryFn: () => getAgentRun(name),
    onError: (error: AxiosError) => console.log(error),
    retry: AGENTIC_QUERY_RETRY,
    refetchInterval: (_data, query) =>
      pollUnlessErrored(query, refetchInterval),
    refetchIntervalInBackground: true,
    enabled: !!name,
  });

  return {
    agentRun: data,
    isLoading,
    fetchError: error,
  };
};

/**
 * The child AgentRuns of a workflow-run's stages, fetched in parallel on
 * the same key and 5s poll as useFetchAgentRun, so the stage cards and
 * the per-stage panel see the same cache the run pages do.
 */
export const useFetchAgentRunsByNames = (names: string[]) => {
  const queries = useQueries({
    queries: names.map((name) => ({
      queryKey: [AGENT_RUN_QUERY_KEY, name],
      queryFn: () => getAgentRun(name),
      retry: AGENTIC_QUERY_RETRY,
      refetchInterval: (
        _data: unknown,
        query: { state: { status: QueryStatus } }
      ) => pollUnlessErrored(query, DEFAULT_REFETCH_INTERVAL),
      refetchIntervalInBackground: true,
      enabled: !!name,
    })),
  });
  const runs: Record<string, AgentRun | undefined> = {};
  names.forEach((name, i) => {
    runs[name] = queries[i]?.data;
  });
  return {
    runs,
    isLoading: queries.some((q) => q.isLoading),
  };
};

export const useCreateAgentRunMutation = (
  onSuccess: (run: AgentRun) => void,
  onError: (err: AxiosError) => void
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAgentRun,
    onSuccess: (data) => {
      onSuccess(data);
      queryClient.invalidateQueries({ queryKey: [AGENT_RUNS_QUERY_KEY] });
    },
    onError,
  });
};

export const useDeleteAgentRunsMutation = (
  onSuccess: (names: string[]) => void,
  onError: (err: AxiosError) => void
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (names: string[]) =>
      Promise.all(names.map((name) => deleteAgentRun(name))),
    onSuccess: (_, names) => onSuccess(names),
    onError,
    // Promise.all can reject after another request has already succeeded, so
    // refresh on both success and failure to reflect the server's real state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: [AGENT_RUNS_QUERY_KEY] }),
  });
};
